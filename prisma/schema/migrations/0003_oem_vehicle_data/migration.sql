-- CreateTable
CREATE TABLE "core_ord_oem_vehicle" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_id" TEXT NOT NULL,
    "chassis_no" TEXT NOT NULL,
    "engine_no" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vahan_category" TEXT,
    "dealer_id" TEXT,
    "invoice_no" TEXT,
    "invoice_date" TEXT,
    "source" TEXT NOT NULL DEFAULT 'FILE',
    "import_job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_ord_oem_vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_ord_oem_vehicle_tenant_id_chassis_no_idx" ON "core_ord_oem_vehicle"("tenant_id", "chassis_no");

-- CreateIndex
CREATE UNIQUE INDEX "core_ord_oem_vehicle_tenant_id_oem_id_chassis_no_key" ON "core_ord_oem_vehicle"("tenant_id", "oem_id", "chassis_no");

