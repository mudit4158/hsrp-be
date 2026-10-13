"""Imports every module's models so Base.metadata knows all tables (Alembic, tests). Generated tables: scripts/prisma_to_sqlalchemy.py."""

import app.adapters.models  # noqa: F401
import app.core.billing.models  # noqa: F401
import app.core.booking.models  # noqa: F401
import app.core.dispatch.models  # noqa: F401
import app.core.fitment.models  # noqa: F401
import app.core.inventory.models  # noqa: F401
import app.core.masters.models  # noqa: F401
import app.core.order_intake.models  # noqa: F401
import app.core.pricing.models  # noqa: F401
import app.core.production.models  # noqa: F401
import app.core.rejection.models  # noqa: F401
import app.platform.models  # noqa: F401
import app.utility.approvals.models  # noqa: F401
import app.utility.audit.models  # noqa: F401
import app.utility.configuration.models  # noqa: F401
import app.utility.documents.models  # noqa: F401
import app.utility.file_storage.models  # noqa: F401
import app.utility.identity.models  # noqa: F401
import app.utility.import_export.models  # noqa: F401
import app.utility.integration_hub.models  # noqa: F401
import app.utility.notification.models  # noqa: F401
import app.utility.payments.models  # noqa: F401
import app.utility.reporting.models  # noqa: F401
import app.utility.scheduling.models  # noqa: F401
import app.utility.tickets.models  # noqa: F401
import app.utility.wallet.models  # noqa: F401
