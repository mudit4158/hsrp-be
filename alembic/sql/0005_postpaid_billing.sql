-- CreateTable
CREATE TABLE "core_bil_charge" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "regn_no" TEXT NOT NULL,
    "oem_id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "bill_to_type" TEXT NOT NULL,
    "bill_to_id" TEXT NOT NULL,
    "bill_to_name" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "bill_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_bil_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_bil_bill" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_no" TEXT NOT NULL,
    "oem_id" TEXT NOT NULL,
    "bill_to_type" TEXT NOT NULL,
    "bill_to_id" TEXT NOT NULL,
    "bill_to_name" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "file_id" TEXT,
    "sent_to" TEXT,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_bil_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_bil_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_id" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "bill_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_bil_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_bil_charge_order_id_key" ON "core_bil_charge"("order_id");

-- CreateIndex
CREATE INDEX "core_bil_charge_tenant_id_status_idx" ON "core_bil_charge"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "core_bil_charge_bill_id_idx" ON "core_bil_charge"("bill_id");

-- CreateIndex
CREATE INDEX "core_bil_bill_tenant_id_oem_id_idx" ON "core_bil_bill"("tenant_id", "oem_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_bil_bill_tenant_id_bill_no_key" ON "core_bil_bill"("tenant_id", "bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "core_bil_run_tenant_id_oem_id_period_to_key" ON "core_bil_run"("tenant_id", "oem_id", "period_to");

