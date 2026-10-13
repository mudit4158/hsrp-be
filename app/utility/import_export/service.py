"""File intake with per-source mapping profiles. Rows are mapped and checked on upload; good rows are then processed
from the outbox by the registered target. Bad rows go to a downloadable error report."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import func, select

from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.file_storage.service import FileService
from app.utility.import_export.csv_tools import map_row, parse_csv, template_csv, to_csv
from app.utility.import_export.models import ImportJob, ImportProfile, ImportRow
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus


@dataclass
class ImportRowContext:
    job_id: str
    row_no: int
    profile_code: str
    context: dict[str, str]


class ImportTarget(Protocol):
    """A consumer (e.g. a core module) registers a target type and processes mapped rows. Raise to mark a row bad."""

    def process_row(self, mapped: dict[str, str], ctx: ImportRowContext) -> dict[str, Any]: ...


class ImportService:
    def __init__(self, db: Database, bus: EventBus, files: FileService):
        self.db = db
        self.bus = bus
        self.files = files
        self._targets: dict[str, ImportTarget] = {}
        bus.subscribe("ImportRowsReady", "import.process", self._process)

    def register_target(self, target_type: str, target: ImportTarget) -> None:
        self._targets[target_type] = target

    def _profile(self, code: str) -> ImportProfile | None:
        with self.db.tx() as s:
            return s.scalar(select(ImportProfile).where(ImportProfile.tenant_id == request_context.tenant_id(), ImportProfile.code == code))

    def start(self, profile_code: str, filename: str, data: bytes, context: dict[str, str] | None = None) -> ImportJob:
        tenant_id = request_context.tenant_id()
        profile = self._profile(profile_code)
        if profile is None:
            raise Problem.bad_request(f"Unknown import profile {profile_code}", "profile-unknown")
        if profile.target_type not in self._targets:
            raise Problem.bad_request(f"No handler for {profile.target_type}", "target-unknown")
        try:
            raw = parse_csv(data.decode("utf-8"), profile.delimiter)
        except Exception as e:
            raise Problem.bad_request(f"Could not read the CSV: {e}", "csv-invalid") from e
        if not raw:
            raise Problem.bad_request("The file has no data rows", "csv-empty")
        if len(raw) > 5000:
            raise Problem.bad_request("At most 5000 rows per file", "csv-too-large")
        mapping: dict[str, Any] = profile.mapping
        needs = [k for k in mapping.get("requiredContext") or [] if not (context or {}).get(k)]
        if needs:
            raise Problem.bad_request(f"Profile {profile.code} needs {', '.join(needs)} with the upload", "context-required")
        missing = [c["from"] for c in mapping["columns"].values() if c.get("required") and c["from"] not in raw[0]]
        if missing:
            raise Problem.bad_request(f"Missing column(s) for profile {profile.code}: {', '.join(missing)}", "csv-columns")

        file = self.files.upload(data, filename, "text/csv", "import")
        with self.db.tx() as s:
            job = ImportJob(
                tenant_id=tenant_id,
                profile_code=profile.code,
                target_type=profile.target_type,
                file_id=file.id,
                filename=filename,
                total_rows=len(raw),
                status="PROCESSING",
                created_by=request_context.actor_id(),
            )
            s.add(job)
            s.flush()
            error_rows = 0
            for i, r in enumerate(raw):
                mapped, errors = map_row(r, mapping)
                if errors:
                    error_rows += 1
                s.add(
                    ImportRow(
                        tenant_id=tenant_id,
                        job_id=job.id,
                        row_no=i + 2,
                        raw=r,
                        mapped=mapped,
                        status="ERROR" if errors else "PENDING",
                        errors=errors or None,
                    )
                )
            job.error_rows = error_rows
            s.flush()
            self.files.attach(file.id, "import-job", job.id, "import", s=s)
            self.bus.publish(s, "ImportRowsReady", "import-job", job.id, {"jobId": job.id, "context": {**(mapping.get("context") or {}), **(context or {})}})
            return job

    def template(self, profile_code: str) -> dict[str, str]:
        """The profile's template CSV (headers and an example row)."""
        profile = self._profile(profile_code)
        if profile is None:
            raise Problem.not_found("Import profile")
        return {"filename": f"{profile.code.lower()}-template.csv", "csv": template_csv(profile.mapping)}

    def job(self, id: str) -> ImportJob:
        with self.db.tx() as s:
            job = s.scalar(select(ImportJob).where(ImportJob.id == id, ImportJob.tenant_id == request_context.tenant_id()))
        if job is None:
            raise Problem.not_found("Import job")
        return job

    def jobs(self, target_types: list[str], from_: datetime | None = None, to: datetime | None = None) -> list[dict[str, Any]]:
        """Jobs of the given target types, newest first, with the profile's context (e.g. which OEM sent the file)."""
        tenant_id = request_context.tenant_id()
        q = select(ImportJob).where(ImportJob.tenant_id == tenant_id, ImportJob.target_type.in_(target_types))
        if from_:
            q = q.where(ImportJob.created_at >= from_)
        if to:
            q = q.where(ImportJob.created_at <= to)
        with self.db.tx() as s:
            jobs = s.scalars(q.order_by(ImportJob.created_at.desc()).limit(5000)).all()
            profiles = {p.code: p for p in s.scalars(select(ImportProfile).where(ImportProfile.tenant_id == tenant_id))}
        out = []
        for j in jobs:
            p = profiles.get(j.profile_code)
            out.append({**row(j), "profileName": p.name if p else j.profile_code, "context": ((p.mapping or {}).get("context") if p else None) or {}})
        return out

    def rows(self, job_id: str, status: str | None = None) -> list[ImportRow]:
        q = select(ImportRow).where(ImportRow.job_id == job_id)
        if status:
            q = q.where(ImportRow.status == status)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(ImportRow.row_no)))

    def error_report(self, job_id: str) -> str:
        self.job(job_id)
        rows = self.rows(job_id, "ERROR")
        raw_keys = list(dict.fromkeys(k for r in rows for k in (r.raw or {})))
        return to_csv(
            [{"row": r.row_no, "errors": "; ".join(r.errors or []), **(r.raw or {})} for r in rows],
            [{"key": "row", "label": "Row"}, {"key": "errors", "label": "Errors"}, *({"key": k, "label": k} for k in raw_keys)],
        )

    def _process(self, e: DeliveredEvent) -> None:
        with self.db.tx() as s:
            job = s.get(ImportJob, str(e.payload.get("jobId")))
        if job is None:
            raise NonRetryableError("Import job not found")
        target = self._targets.get(job.target_type)
        if target is None:
            raise RuntimeError(f"No handler for {job.target_type}")
        pending = self.rows(job.id, "PENDING")
        for r in pending:
            try:
                res = target.process_row(r.mapped or {}, ImportRowContext(job.id, r.row_no, job.profile_code, e.payload.get("context") or {}))
                with self.db.tx() as s:
                    x = s.get_one(ImportRow, r.id)
                    x.status, x.result_ref = "OK", res.get("ref")
            except Exception as err:
                msg = (err.detail or err.title) if isinstance(err, Problem) else str(err)
                with self.db.tx() as s:
                    x = s.get_one(ImportRow, r.id)
                    x.status, x.errors = "ERROR", [msg]
        with self.db.tx() as s:
            ok = s.scalar(select(func.count()).select_from(ImportRow).where(ImportRow.job_id == job.id, ImportRow.status == "OK"))
            bad = s.scalar(select(func.count()).select_from(ImportRow).where(ImportRow.job_id == job.id, ImportRow.status == "ERROR"))
            j = s.get_one(ImportJob, job.id)
            j.status, j.ok_rows, j.error_rows = "DONE", ok, bad
