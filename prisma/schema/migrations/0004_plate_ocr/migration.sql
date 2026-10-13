-- CreateTable
CREATE TABLE "core_fit_photo_check" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "fitment_id" TEXT,
    "position" TEXT NOT NULL,
    "file_id" TEXT,
    "expected" TEXT NOT NULL,
    "read_text" TEXT,
    "confidence" INTEGER,
    "engine" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_fit_photo_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_prd_photo_check" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "allocation_id" TEXT NOT NULL,
    "laser_code" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "read_text" TEXT,
    "confidence" INTEGER,
    "engine" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_prd_photo_check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_fit_photo_check_order_id_idx" ON "core_fit_photo_check"("order_id");

-- CreateIndex
CREATE INDEX "core_prd_photo_check_order_id_idx" ON "core_prd_photo_check"("order_id");

-- CreateIndex
CREATE INDEX "core_prd_photo_check_allocation_id_idx" ON "core_prd_photo_check"("allocation_id");

