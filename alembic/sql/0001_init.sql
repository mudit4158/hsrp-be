-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."adp_mock_vahan_vehicle" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "regn_no" TEXT NOT NULL,
    "chassis_no" TEXT NOT NULL,
    "engine_no" TEXT NOT NULL,
    "state_cd" TEXT NOT NULL,
    "off_cd" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "fuel" TEXT NOT NULL,
    "vch_type" TEXT NOT NULL,
    "vch_catg" TEXT NOT NULL,
    "norms" TEXT NOT NULL,
    "regn_date" TEXT NOT NULL,
    "hsrp_front_laser_code" TEXT,
    "hsrp_rear_laser_code" TEXT,
    "scenario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_vahan_vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adp_mock_oem_catalogue" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "chassis_no" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_oem_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adp_mock_setting" (
    "key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."adp_mock_payu_txn" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "txnid" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "mihpayid" TEXT,
    "request" JSONB NOT NULL,
    "refunds" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_payu_txn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adp_mock_outbound_message" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "dlt_template_id" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_outbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adp_mock_oem_callback" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_mock_oem_callback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adp_filestore_blob" (
    "key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adp_filestore_blob_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."platform_tenant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_bkg_booking" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "sched_booking_id" TEXT NOT NULL,
    "slot_date" TEXT NOT NULL,
    "slot_start" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_bkg_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_dsp_challan" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "challan_no" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "created_by" TEXT,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "inwarded_at" TIMESTAMP(3),
    "inwarded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_dsp_challan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_dsp_challan_line" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "challan_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "allocation_id" TEXT NOT NULL,
    "laser_code" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "inward_status" TEXT NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_dsp_challan_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_fit_fitment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "front_laser_code" TEXT,
    "rear_laser_code" TEXT,
    "front_photo_id" TEXT,
    "rear_photo_id" TEXT,
    "chassis_photo_id" TEXT,
    "fitted_at" TIMESTAMP(3) NOT NULL,
    "recorded_by" TEXT,
    "device_id" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "vahan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "vahan_reply" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_fit_fitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_inv_box" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "box_no" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "plate_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_inv_box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_inv_plate" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "laser_code" TEXT NOT NULL,
    "box_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_inv_plate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_inv_allocation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plate_id" TEXT NOT NULL,
    "laser_code" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "job_card_id" TEXT,
    "close_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_inv_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_state" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule_pack" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_company" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "gstin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_station" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "org_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_oem" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "requires_catalogue_check" BOOLEAN NOT NULL DEFAULT false,
    "org_id" TEXT,
    "wallet_account_id" TEXT,
    "import_profile_code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_oem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_dealer" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "station_id" TEXT NOT NULL,
    "org_id" TEXT,
    "wallet_group" TEXT NOT NULL,
    "wallet_account_id" TEXT,
    "accepts_customer_orders" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_dealer_oem" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "oem_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_dealer_oem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_product" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size_mm" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_mst_vehicle_category" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vahan_category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "vehicle_type" TEXT NOT NULL,
    "front_product_code" TEXT NOT NULL,
    "rear_product_code" TEXT NOT NULL,
    "sticker_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_mst_vehicle_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_ord_order" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "plate_set" TEXT NOT NULL DEFAULT 'BOTH',
    "replacement_reason" TEXT,
    "evidence_file_id" TEXT,
    "status" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "regn_no" TEXT NOT NULL,
    "chassis_no" TEXT NOT NULL,
    "engine_no" TEXT NOT NULL,
    "oem_id" TEXT,
    "dealer_id" TEXT,
    "station_id" TEXT,
    "source_ref" TEXT,
    "vehicle_class" TEXT,
    "vehicle_type" TEXT,
    "vahan_category" TEXT,
    "fuel" TEXT,
    "maker" TEXT,
    "norms" TEXT,
    "regn_date" TEXT,
    "green_strip" BOOLEAN NOT NULL DEFAULT false,
    "sticker_required" BOOLEAN NOT NULL DEFAULT false,
    "front_product_code" TEXT,
    "rear_product_code" TEXT,
    "pending_positions" TEXT[],
    "owner_name" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "amount_paise" INTEGER,
    "price_snapshot" JSONB,
    "vahan_snapshot" JSONB,
    "wallet_hold_id" TEXT,
    "payment_id" TEXT,
    "approval_id" TEXT,
    "rejection_reason" TEXT,
    "cancel_reason" TEXT,
    "remarks" TEXT,
    "created_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_ord_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_ord_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_ord_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_ord_validation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_ord_validation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_ord_vehicle_check" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "regn_no" TEXT NOT NULL,
    "chassis_last5" TEXT NOT NULL,
    "engine_last5" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_ord_vehicle_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_price_rule" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "oem_code" TEXT,
    "order_type" TEXT NOT NULL,
    "plate_set" TEXT NOT NULL DEFAULT 'BOTH',
    "amount_paise" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_price_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_price_extra_charge" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_price_extra_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_prd_job_card" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_card_no" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "order_ids" TEXT[],
    "box_nos" TEXT[],
    "plate_count" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_prd_job_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_prd_qc" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "positions" TEXT[],
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_prd_qc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_prd_sticker_print" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "print_no" INTEGER NOT NULL,
    "reprint" BOOLEAN NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_prd_sticker_print_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."core_rej_case" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "station_id" TEXT,
    "source" TEXT NOT NULL,
    "positions" TEXT[],
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_id" TEXT,
    "return_status" TEXT NOT NULL,
    "challan_id" TEXT,
    "decided_by" TEXT,
    "remarks" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_rej_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_approval_request" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "required_role" TEXT NOT NULL,
    "scope_org_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "details" JSONB,
    "requested_by" TEXT,
    "decided_by" TEXT,
    "remarks" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "device" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "util_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_config_setting" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_config_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_doc_template" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "page_size" TEXT NOT NULL DEFAULT 'A4',
    "layout" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_doc_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_doc_sequence" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_doc_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_file_object" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "purpose" TEXT,
    "owner_subject_type" TEXT,
    "owner_subject_id" TEXT,
    "retention_until" TIMESTAMP(3),
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_file_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_org" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "org_type" TEXT NOT NULL,
    "parent_id" TEXT,
    "external_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_user" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "org_id" TEXT,
    "roles" TEXT[],
    "mobile" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_otp" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "context" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_api_client" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "roles" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_api_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_iam_device" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_iam_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_import_profile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT ',',
    "mapping" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_import_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_import_job" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_code" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "file_id" TEXT,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "ok_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_import_row" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "mapped" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errors" JSONB,
    "result_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_hub_outbox_event" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "payload" JSONB NOT NULL,
    "actor_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_hub_outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_hub_outbox_delivery" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "subscriber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_hub_outbox_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_hub_idempotency_key" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "response_code" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_hub_idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_hub_call_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "request" JSONB,
    "response" JSONB,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_hub_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_notify_template" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "dlt_template_id" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_notify_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_notify_message" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "dlt_template_id" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider_ref" TEXT,
    "error" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_notify_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_pay_payment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "txn_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "product_info" TEXT NOT NULL,
    "payer" JSONB NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "return_url" TEXT NOT NULL,
    "provider_ref" TEXT,
    "succeeded_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_pay_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_pay_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "txn_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "hash_valid" BOOLEAN,
    "result_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_pay_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_pay_refund" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "provider_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_pay_refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_report_saved" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "report_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_report_saved_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_sched_resource" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_sched_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_sched_calendar_rule" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "slot_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_sched_calendar_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_sched_closure" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_sched_closure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_sched_booking" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slot_start" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_sched_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_ticket_category" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sla_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_ticket_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_ticket" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ticket_no" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "raised_by_name" TEXT NOT NULL,
    "raised_by_contact" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_ticket_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_ticket_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_wallet_account" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "balance_paise" INTEGER NOT NULL DEFAULT 0,
    "credit_limit_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_wallet_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_wallet_journal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "reference" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_wallet_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_wallet_entry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "balance_after_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_wallet_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."util_wallet_hold" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "wallet_account_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "hold_journal_id" TEXT NOT NULL,
    "settle_journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "util_wallet_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adp_mock_vahan_vehicle_regn_no_key" ON "public"."adp_mock_vahan_vehicle"("regn_no");

-- CreateIndex
CREATE UNIQUE INDEX "adp_mock_oem_catalogue_oem_code_chassis_no_key" ON "public"."adp_mock_oem_catalogue"("oem_code", "chassis_no");

-- CreateIndex
CREATE UNIQUE INDEX "adp_mock_payu_txn_txnid_key" ON "public"."adp_mock_payu_txn"("txnid");

-- CreateIndex
CREATE UNIQUE INDEX "core_bkg_booking_order_id_key" ON "public"."core_bkg_booking"("order_id");

-- CreateIndex
CREATE INDEX "core_bkg_booking_dealer_id_slot_date_idx" ON "public"."core_bkg_booking"("dealer_id", "slot_date");

-- CreateIndex
CREATE INDEX "core_dsp_challan_tenant_id_dealer_id_status_idx" ON "public"."core_dsp_challan"("tenant_id", "dealer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "core_dsp_challan_tenant_id_challan_no_key" ON "public"."core_dsp_challan"("tenant_id", "challan_no");

-- CreateIndex
CREATE INDEX "core_dsp_challan_line_challan_id_idx" ON "public"."core_dsp_challan_line"("challan_id");

-- CreateIndex
CREATE INDEX "core_dsp_challan_line_order_id_idx" ON "public"."core_dsp_challan_line"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_fit_fitment_order_id_key" ON "public"."core_fit_fitment"("order_id");

-- CreateIndex
CREATE INDEX "core_fit_fitment_tenant_id_vahan_status_idx" ON "public"."core_fit_fitment"("tenant_id", "vahan_status");

-- CreateIndex
CREATE UNIQUE INDEX "core_inv_box_tenant_id_box_no_key" ON "public"."core_inv_box"("tenant_id", "box_no");

-- CreateIndex
CREATE INDEX "core_inv_plate_box_id_status_idx" ON "public"."core_inv_plate"("box_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "core_inv_plate_tenant_id_laser_code_key" ON "public"."core_inv_plate"("tenant_id", "laser_code");

-- CreateIndex
CREATE INDEX "core_inv_allocation_order_id_idx" ON "public"."core_inv_allocation"("order_id");

-- CreateIndex
CREATE INDEX "core_inv_allocation_laser_code_idx" ON "public"."core_inv_allocation"("laser_code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_state_tenant_id_code_key" ON "public"."core_mst_state"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_company_tenant_id_code_key" ON "public"."core_mst_company"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_station_tenant_id_code_key" ON "public"."core_mst_station"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_oem_tenant_id_code_key" ON "public"."core_mst_oem"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_dealer_tenant_id_code_key" ON "public"."core_mst_dealer"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_dealer_oem_dealer_id_oem_id_key" ON "public"."core_mst_dealer_oem"("dealer_id", "oem_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_product_tenant_id_code_key" ON "public"."core_mst_product"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_mst_vehicle_category_tenant_id_vahan_category_key" ON "public"."core_mst_vehicle_category"("tenant_id", "vahan_category");

-- CreateIndex
CREATE INDEX "core_ord_order_tenant_id_status_idx" ON "public"."core_ord_order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "core_ord_order_tenant_id_regn_no_idx" ON "public"."core_ord_order"("tenant_id", "regn_no");

-- CreateIndex
CREATE INDEX "core_ord_order_tenant_id_dealer_id_status_idx" ON "public"."core_ord_order"("tenant_id", "dealer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "core_ord_order_tenant_id_order_no_key" ON "public"."core_ord_order"("tenant_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "core_ord_order_tenant_id_oem_id_source_ref_key" ON "public"."core_ord_order"("tenant_id", "oem_id", "source_ref");

-- CreateIndex
CREATE INDEX "core_ord_status_history_order_id_created_at_idx" ON "public"."core_ord_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "core_ord_validation_order_id_idx" ON "public"."core_ord_validation"("order_id");

-- CreateIndex
CREATE INDEX "core_price_rule_tenant_id_state_code_vehicle_class_order_ty_idx" ON "public"."core_price_rule"("tenant_id", "state_code", "vehicle_class", "order_type");

-- CreateIndex
CREATE UNIQUE INDEX "core_prd_job_card_tenant_id_job_card_no_key" ON "public"."core_prd_job_card"("tenant_id", "job_card_no");

-- CreateIndex
CREATE INDEX "core_prd_qc_order_id_idx" ON "public"."core_prd_qc"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_prd_sticker_print_order_id_print_no_key" ON "public"."core_prd_sticker_print"("order_id", "print_no");

-- CreateIndex
CREATE INDEX "core_rej_case_tenant_id_status_idx" ON "public"."core_rej_case"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "core_rej_case_order_id_idx" ON "public"."core_rej_case"("order_id");

-- CreateIndex
CREATE INDEX "util_approval_request_tenant_id_type_status_idx" ON "public"."util_approval_request"("tenant_id", "type", "status");

-- CreateIndex
CREATE INDEX "util_approval_request_tenant_id_subject_type_subject_id_idx" ON "public"."util_approval_request"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "util_audit_log_tenant_id_subject_type_subject_id_idx" ON "public"."util_audit_log"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "util_audit_log_tenant_id_created_at_idx" ON "public"."util_audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "util_config_setting_tenant_id_key_idx" ON "public"."util_config_setting"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "util_doc_template_tenant_id_code_key" ON "public"."util_doc_template"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "util_doc_sequence_tenant_id_name_key" ON "public"."util_doc_sequence"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "util_file_object_tenant_id_owner_subject_type_owner_subject_idx" ON "public"."util_file_object"("tenant_id", "owner_subject_type", "owner_subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "util_iam_org_tenant_id_code_key" ON "public"."util_iam_org"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "util_iam_role_tenant_id_code_key" ON "public"."util_iam_role"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "util_iam_user_tenant_id_username_key" ON "public"."util_iam_user"("tenant_id", "username");

-- CreateIndex
CREATE INDEX "util_iam_otp_tenant_id_recipient_idx" ON "public"."util_iam_otp"("tenant_id", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "util_iam_api_client_key_hash_key" ON "public"."util_iam_api_client"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "util_iam_device_tenant_id_user_id_device_id_key" ON "public"."util_iam_device"("tenant_id", "user_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "util_import_profile_tenant_id_code_key" ON "public"."util_import_profile"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "util_import_row_job_id_row_no_idx" ON "public"."util_import_row"("job_id", "row_no");

-- CreateIndex
CREATE INDEX "util_hub_outbox_event_dispatched_at_seq_idx" ON "public"."util_hub_outbox_event"("dispatched_at", "seq");

-- CreateIndex
CREATE INDEX "util_hub_outbox_event_tenant_id_subject_type_subject_id_idx" ON "public"."util_hub_outbox_event"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "util_hub_outbox_delivery_status_next_attempt_at_idx" ON "public"."util_hub_outbox_delivery"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "util_hub_outbox_delivery_event_id_subscriber_key" ON "public"."util_hub_outbox_delivery"("event_id", "subscriber");

-- CreateIndex
CREATE UNIQUE INDEX "util_hub_idempotency_key_tenant_id_scope_key_key" ON "public"."util_hub_idempotency_key"("tenant_id", "scope", "key");

-- CreateIndex
CREATE INDEX "util_hub_call_log_tenant_id_system_created_at_idx" ON "public"."util_hub_call_log"("tenant_id", "system", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "util_notify_template_tenant_id_code_channel_key" ON "public"."util_notify_template"("tenant_id", "code", "channel");

-- CreateIndex
CREATE INDEX "util_notify_message_tenant_id_created_at_idx" ON "public"."util_notify_message"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "util_pay_payment_txn_id_key" ON "public"."util_pay_payment"("txn_id");

-- CreateIndex
CREATE INDEX "util_pay_payment_tenant_id_subject_type_subject_id_idx" ON "public"."util_pay_payment"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "util_pay_event_tenant_id_payment_id_idx" ON "public"."util_pay_event"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "util_sched_resource_tenant_id_code_key" ON "public"."util_sched_resource"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "util_sched_calendar_rule_resource_id_weekday_idx" ON "public"."util_sched_calendar_rule"("resource_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "util_sched_closure_resource_id_date_key" ON "public"."util_sched_closure"("resource_id", "date");

-- CreateIndex
CREATE INDEX "util_sched_booking_resource_id_date_slot_start_status_idx" ON "public"."util_sched_booking"("resource_id", "date", "slot_start", "status");

-- CreateIndex
CREATE UNIQUE INDEX "util_ticket_category_tenant_id_code_key" ON "public"."util_ticket_category"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "util_ticket_ticket_no_key" ON "public"."util_ticket"("ticket_no");

-- CreateIndex
CREATE INDEX "util_ticket_tenant_id_status_idx" ON "public"."util_ticket"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "util_ticket_event_ticket_id_idx" ON "public"."util_ticket_event"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "util_wallet_account_tenant_id_owner_type_owner_id_kind_key" ON "public"."util_wallet_account"("tenant_id", "owner_type", "owner_id", "kind");

-- CreateIndex
CREATE INDEX "util_wallet_entry_account_id_created_at_idx" ON "public"."util_wallet_entry"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "util_wallet_hold_wallet_account_id_status_idx" ON "public"."util_wallet_hold"("wallet_account_id", "status");

