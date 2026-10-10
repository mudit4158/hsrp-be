import type { Layout } from '../utility/documents/pdf-renderer';

/** All seed data is fictional. Names say so; phone numbers and e-mail domains are not real. */

export const TENANT = { id: 't-demo', name: 'Demo HSRP Company (fictional)' };

export const ROLES: Array<{ code: string; name: string; permissions: string[] }> = [
  { code: 'ADMIN', name: 'Administrator', permissions: ['*'] },
  {
    code: 'OPERATIONS',
    name: 'Operations',
    permissions: [
      'orders.read', 'orders.create', 'orders.cancel', 'approvals.read', 'approvals.decide', 'masters.read', 'masters.manage', 'pricing.manage',
      'inventory.read', 'station.read', 'wallet.read', 'wallet.manage', 'tickets.manage', 'reports.read', 'audit.read', 'integration.monitor',
      'integration.replay', 'imports.run', 'files.upload', 'files.read', 'payments.read', 'notifications.read', 'config.read', 'scheduling.manage',
    ],
  },
  {
    code: 'STATION_USER',
    name: 'Embossing station user',
    permissions: ['orders.read', 'station.operate', 'station.read', 'inventory.read', 'approvals.read', 'approvals.decide', 'files.read', 'files.upload', 'imports.run', 'reports.read', 'masters.read'],
  },
  {
    code: 'DEALER',
    name: 'Dealer',
    permissions: ['dealer.app', 'orders.read', 'orders.create', 'orders.cancel', 'inward.record', 'fitment.record', 'files.upload', 'files.read'],
  },
  { code: 'OEM_CLIENT', name: 'OEM system (API client)', permissions: ['oem.orders.push'] },
  { code: 'CUSTOMER', name: 'Customer (OTP session)', permissions: ['portal.customer', 'payments.pay'] },
];

export const STATES = [
  { code: 'WB', name: 'West Bengal', rulePack: 'base' },
  { code: 'OD', name: 'Odisha', rulePack: 'odisha' },
];

export const COMPANY = { code: 'SPPL', name: 'Suraksha Plates Pvt Ltd (fictional)', address: '1 Demo Industrial Estate, Kolkata', gstin: '19AAAAA0000A1Z5' };

export const STATIONS = [
  { code: 'KOL1', name: 'Kolkata Embossing Station', stateCode: 'WB', city: 'Kolkata', address: 'Plot 7, Demo Park, Kolkata', laserPrefix: 'KA' },
  { code: 'BBS1', name: 'Bhubaneswar Embossing Station', stateCode: 'OD', city: 'Bhubaneswar', address: 'Unit 3, Demo Zone, Bhubaneswar', laserPrefix: 'OB' },
];

export const OEMS = [
  { code: 'ZENMO', name: 'Zenmo Motors (fictional)', integration: 'API', requiresCatalogueCheck: true, maker: 'ZENMO MOTORS (FICTIONAL)' },
  { code: 'KRANTI', name: 'Kranti Autos (fictional)', integration: 'CSV', requiresCatalogueCheck: false, maker: 'KRANTI AUTOS (FICTIONAL)', importProfileCode: 'OEM_KRANTI_CSV' },
];

export const DEALERS = [
  { code: 'WB01', name: 'Howrah Wheels (demo)', stateCode: 'WB', city: 'Howrah', station: 'KOL1', walletGroup: 'GRP-EAST-A', oems: ['ZENMO', 'KRANTI'] },
  { code: 'WB02', name: 'Salt Lake Motors (demo)', stateCode: 'WB', city: 'Kolkata', station: 'KOL1', walletGroup: 'GRP-EAST-A', oems: ['ZENMO'] },
  { code: 'WB03', name: 'Durgapur Auto Hub (demo)', stateCode: 'WB', city: 'Durgapur', station: 'KOL1', walletGroup: 'GRP-WB03', oems: ['KRANTI'] },
  { code: 'OD01', name: 'Cuttack Car Point (demo)', stateCode: 'OD', city: 'Cuttack', station: 'BBS1', walletGroup: 'GRP-KALINGA', oems: ['KRANTI'] },
  { code: 'OD02', name: 'Kalinga Motors (demo)', stateCode: 'OD', city: 'Bhubaneswar', station: 'BBS1', walletGroup: 'GRP-KALINGA', oems: ['ZENMO', 'KRANTI'] },
  { code: 'OD03', name: 'Puri Two Wheelers (demo)', stateCode: 'OD', city: 'Puri', station: 'BBS1', walletGroup: 'GRP-OD03', oems: ['KRANTI'] },
];

/** Wallet groups: two are shared by two dealers each. Amounts in rupees. */
export const WALLETS: Record<string, { topUp: number; credit: number }> = {
  'GRP-EAST-A': { topUp: 300_000, credit: 50_000 },
  'GRP-KALINGA': { topUp: 250_000, credit: 25_000 },
  'GRP-WB03': { topUp: 40_000, credit: 0 },
  'GRP-OD03': { topUp: 300, credit: 0 },
};

export const PRODUCTS = [
  { code: '285X45', name: 'Plate 285 × 45 mm (two-wheeler front)', sizeMm: '285x45' },
  { code: '200X100', name: 'Plate 200 × 100 mm (two-wheeler rear, three-wheeler)', sizeMm: '200x100' },
  { code: '500X120', name: 'Plate 500 × 120 mm (car)', sizeMm: '500x120' },
  { code: '340X200', name: 'Plate 340 × 200 mm (heavy vehicle, trailer)', sizeMm: '340x200' },
];

export const VEHICLE_CATEGORIES = [
  { vahanCategory: '2WN', description: 'Two-wheeler (non-transport)', vehicleClass: '2W', vehicleType: 'NON_TRANSPORT', frontProductCode: '285X45', rearProductCode: '200X100', stickerRequired: false },
  { vahanCategory: '2WT', description: 'Two-wheeler (transport)', vehicleClass: '2W', vehicleType: 'TRANSPORT', frontProductCode: '285X45', rearProductCode: '200X100', stickerRequired: false },
  { vahanCategory: '3WN', description: 'Three-wheeler (non-transport)', vehicleClass: '3W', vehicleType: 'NON_TRANSPORT', frontProductCode: '200X100', rearProductCode: '200X100', stickerRequired: false },
  { vahanCategory: '3WT', description: 'Three-wheeler (transport)', vehicleClass: '3W', vehicleType: 'TRANSPORT', frontProductCode: '200X100', rearProductCode: '200X100', stickerRequired: false },
  { vahanCategory: 'LMV', description: 'Light motor vehicle (car)', vehicleClass: 'LMV', vehicleType: 'NON_TRANSPORT', frontProductCode: '500X120', rearProductCode: '500X120', stickerRequired: true },
  { vahanCategory: 'LPV', description: 'Light passenger vehicle (taxi)', vehicleClass: 'LMV', vehicleType: 'TRANSPORT', frontProductCode: '500X120', rearProductCode: '500X120', stickerRequired: true },
  { vahanCategory: 'HGV', description: 'Heavy goods vehicle', vehicleClass: 'HMV', vehicleType: 'TRANSPORT', frontProductCode: '340X200', rearProductCode: '340X200', stickerRequired: true },
  { vahanCategory: 'TRL', description: 'Trailer', vehicleClass: 'TRAILER', vehicleType: 'TRANSPORT', frontProductCode: '340X200', rearProductCode: '340X200', stickerRequired: false },
];

/** Base price (₹) for a front + rear set of a NEW order. */
export const BASE_PRICE: Record<string, number> = { '2W': 420, '3W': 460, LMV: 780, HMV: 820, TRAILER: 720 };
export const ORDER_TYPE_FACTOR: Record<string, number> = { NEW: 1, OLD: 1.1, REPLACEMENT: 1.2 };
export const PLATE_SET_FACTOR: Record<string, number> = { BOTH: 1, FRONT: 0.55, REAR: 0.55 };
/** Odisha publishes slightly different prices (separate rule pack). */
export const STATE_FACTOR: Record<string, number> = { WB: 1, OD: 1.05 };

export const SETTINGS: Array<{ key: string; scopeType: string; scopeId: string; value: unknown }> = [
  { key: 'order.newVehicleCutoff', scopeType: 'global', scopeId: '*', value: '2019-04-01' },
  { key: 'order.validationSteps', scopeType: 'global', scopeId: '*', value: ['vahan-check', 'state-eligibility-rules'] },
  { key: 'order.validationSteps', scopeType: 'oem', scopeId: 'ZENMO', value: ['oem-catalogue-check', 'vahan-check', 'state-eligibility-rules'] },
  { key: 'order.validationSteps', scopeType: 'oem', scopeId: 'KRANTI', value: ['vahan-check', 'state-eligibility-rules'] },
  { key: 'state.rules', scopeType: 'state', scopeId: 'WB', value: { smsStatusUpdates: false, requireMobile: false, publishedPrices: false } },
  {
    key: 'state.rules',
    scopeType: 'state',
    scopeId: 'OD',
    value: { smsStatusUpdates: true, requireMobile: true, allowedVehicleClasses: ['2W', '3W', 'LMV', 'HMV', 'TRAILER'], rtoPrefixes: ['OD'], publishedPrices: true },
  },
  { key: 'fitment.photoRules', scopeType: 'global', scopeId: '*', value: { front: true, rear: true, chassis: false } },
  { key: 'booking.horizonDays', scopeType: 'global', scopeId: '*', value: 30 },
  { key: 'booking.maxReschedules', scopeType: 'global', scopeId: '*', value: 2 },
  { key: 'feature.mobileHoldBeforeFitment', scopeType: 'global', scopeId: '*', value: false },
  { key: 'feature.homeFitment', scopeType: 'global', scopeId: '*', value: false },
  { key: 'vahan.userId', scopeType: 'global', scopeId: '*', value: 'HSRPDEMO' },
  { key: 'alerts.opsEmail', scopeType: 'global', scopeId: '*', value: 'operations@hsrp-demo.invalid' },
  { key: 'alerts.vahanEodHourIst', scopeType: 'global', scopeId: '*', value: 22 },
];

export const SEQUENCES = [
  { name: 'order', prefix: 'HS{STATE}{YY}{MM}', padding: 5 },
  { name: 'job-card', prefix: 'JC{YY}{MM}-', padding: 5 },
  { name: 'challan', prefix: 'DC{YY}{MM}-', padding: 5 },
  { name: 'ticket', prefix: 'CMP{YY}{MM}-', padding: 5 },
];

const DLT = (n: number) => `1107${String(160000000000000 + n)}`;
export const NOTIFY_TEMPLATES = [
  { code: 'OTP', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(1), body: '{{otp}} is your HSRP verification code. It is valid for {{minutes}} minutes. Do not share it. -HSRP Demo' },
  { code: 'ORDER_CONFIRMED', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(2), body: 'Your HSRP order {{orderNo}} for {{regnNo}} is confirmed. -HSRP Demo' },
  { code: 'ORDER_STATUS', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(3), body: 'HSRP order {{orderNo}} for {{regnNo}} is now {{status}}. -HSRP Demo' },
  { code: 'ORDER_REJECTED', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(4), body: 'HSRP order {{orderNo}} for {{regnNo}} could not be accepted: {{reason}}. -HSRP Demo' },
  { code: 'BOOKING_CONFIRMED', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(5), body: 'HSRP fitment for {{regnNo}} is booked at {{centre}} on {{date}} at {{time}}. -HSRP Demo' },
  { code: 'FITMENT_DONE', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(6), body: 'HSRP plates are fitted on {{regnNo}} (order {{orderNo}}) and updated on VAHAN. Thank you. -HSRP Demo' },
  { code: 'TICKET_CREATED', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(7), body: 'Complaint {{ticketNo}} is registered. We will resolve it within {{days}} days. -HSRP Demo' },
  { code: 'TICKET_UPDATED', channel: 'SMS', senderId: 'HSRPDM', dltTemplateId: DLT(8), body: 'Update on complaint {{ticketNo}}: {{status}}. Check HSRP Support for details. -HSRP Demo' },
  {
    code: 'PAYMENT_RECEIPT',
    channel: 'EMAIL',
    senderId: 'no-reply@hsrp-demo.invalid',
    dltTemplateId: null,
    subject: 'Payment received for HSRP order {{orderNo}}',
    body: 'We received ₹{{amount}} for HSRP order {{orderNo}} ({{regnNo}}). You can download the receipt from the HSRP Status page.',
  },
  {
    code: 'VAHAN_PENDING_ALERT',
    channel: 'EMAIL',
    senderId: 'alerts@hsrp-demo.invalid',
    dltTemplateId: null,
    subject: 'VAHAN posts pending at end of day {{date}}',
    body: '{{count}} fitment record(s) are still waiting to be posted to VAHAN. Check the integration monitor.',
  },
];

export const TICKET_CATEGORIES = [
  { code: 'PLATE_DELAY', name: 'Plates not received / delay', slaDays: 15 },
  { code: 'FITMENT_ISSUE', name: 'Problem with fitment', slaDays: 15 },
  { code: 'PAYMENT', name: 'Payment or refund', slaDays: 15 },
  { code: 'WRONG_DETAILS', name: 'Wrong details on plate or sticker', slaDays: 15 },
  { code: 'OTHER', name: 'Other', slaDays: 15 },
];

export const IMPORT_PROFILES = [
  {
    code: 'OEM_KRANTI_CSV',
    name: 'Kranti Autos order file',
    sourceName: 'Kranti Autos (fictional)',
    targetType: 'hsrp.oem-order',
    mapping: {
      columns: {
        oemOrderRef: { from: 'Invoice No', required: true },
        dealerCode: { from: 'Dealer Code', required: true, transform: 'upper' },
        regnNo: { from: 'Registration No', required: true, transform: 'upper' },
        chassisNo: { from: 'Chassis No', required: true, transform: 'upper' },
        engineNo: { from: 'Engine No', required: true, transform: 'upper' },
        ownerName: { from: 'Customer Name' },
        mobile: { from: 'Mobile', transform: 'digits' },
      },
      context: { oemCode: 'KRANTI' },
    },
  },
  {
    code: 'STOCK_RECEIPT',
    name: 'Plate stock receipt',
    sourceName: 'Plate manufacturer delivery note',
    targetType: 'hsrp.stock-receipt',
    mapping: {
      columns: {
        boxNo: { from: 'Box No', required: true, transform: 'upper' },
        stationCode: { from: 'Station', required: true, transform: 'upper' },
        productCode: { from: 'Product', required: true, transform: 'upper' },
        laserCode: { from: 'Laser Code', required: true, transform: 'upper' },
      },
    },
  },
];

export const DOC_TEMPLATES: Array<{ code: string; name: string; layout: Layout }> = [
  {
    code: 'job-card',
    name: 'Job card',
    layout: {
      page: 'A4',
      elements: [
        { type: 'heading', text: 'JOB CARD  {{card.jobCardNo}}', size: 18 },
        { type: 'text', text: '{{station.name}} · prototype print format', size: 9 },
        { type: 'spacer', height: 8 },
        {
          type: 'fields',
          columns: 3,
          items: [
            { label: 'Date', value: '{{card.date}}' },
            { label: 'Dealer', value: '{{dealer.code}} · {{dealer.name}}' },
            { label: 'Plates', value: '{{card.plateCount}}' },
            { label: 'Boxes', value: '{{card.boxes}}' },
            { label: 'Orders', value: '{{card.orderIds.length}}' },
          ],
        },
        { type: 'rule' },
        {
          type: 'table',
          source: 'lines',
          columns: [
            { header: '#', value: '{{rowNo}}', width: 0.4 },
            { header: 'Order', value: '{{orderNo}}', width: 1.6 },
            { header: 'Registration', value: '{{regnNo}}', width: 1.3 },
            { header: 'Class', value: '{{vehicleClass}}', width: 0.7 },
            { header: 'Position', value: '{{position}}', width: 0.8 },
            { header: 'Product', value: '{{product}}', width: 0.9 },
            { header: 'Laser code', value: '{{laserCode}}', width: 1.4 },
          ],
        },
        { type: 'signature', labels: ['Issued by', 'Embossed by', 'QC by'] },
      ],
    },
  },
  {
    code: 'challan',
    name: 'Delivery challan',
    layout: {
      page: 'A4',
      elements: [
        { type: 'heading', text: 'DELIVERY CHALLAN  {{challan.challanNo}}', size: 18 },
        { type: 'text', text: 'From {{station.name}}, {{station.city}}  →  {{dealer.name}}, {{dealer.city}}', size: 10 },
        { type: 'spacer', height: 8 },
        {
          type: 'fields',
          columns: 3,
          items: [
            { label: 'Date', value: '{{challan.date}}' },
            { label: 'Dealer code', value: '{{dealer.code}}' },
            { label: 'Plates', value: '{{challan.plateCount}}' },
            { label: 'Status', value: '{{challan.status}}' },
          ],
        },
        { type: 'rule' },
        {
          type: 'table',
          source: 'lines',
          columns: [
            { header: '#', value: '{{rowNo}}', width: 0.4 },
            { header: 'Order', value: '{{orderNo}}', width: 1.6 },
            { header: 'Registration', value: '{{regnNo}}', width: 1.3 },
            { header: 'Position', value: '{{position}}', width: 0.8 },
            { header: 'Laser code', value: '{{laserCode}}', width: 1.4 },
            { header: 'Inward', value: '{{inwardStatus}}', width: 0.9 },
          ],
        },
        { type: 'text', text: 'This challan cannot be edited. To change it, cancel it and create a new one.', size: 8 },
        { type: 'signature', labels: ['Dispatched by (station)', 'Received by (dealer)'] },
      ],
    },
  },
  {
    code: 'sticker',
    name: 'Third registration sticker',
    layout: {
      page: 'STICKER',
      margin: 14,
      elements: [
        { type: 'band', text: 'BS-VI  ·  {{fuelLabel}}', color: '#15803d', when: 'greenStrip' },
        { type: 'big', text: '{{regnNo}}', size: 30 },
        { type: 'spacer', height: 4 },
        {
          type: 'fields',
          columns: 2,
          items: [
            { label: 'Front laser code', value: '{{front}}' },
            { label: 'Rear laser code', value: '{{rear}}' },
            { label: 'Engine no', value: '{{engineNo}}' },
            { label: 'Chassis no', value: '{{chassisNo}}' },
          ],
        },
        { type: 'text', text: '{{stateName}} · {{orderNo}} · {{printLabel}}', size: 7, align: 'center' },
      ],
    },
  },
  {
    code: 'receipt',
    name: 'Payment receipt',
    layout: {
      page: 'A5',
      elements: [
        { type: 'heading', text: 'PAYMENT RECEIPT', size: 16 },
        { type: 'text', text: 'HSRP Demo (fictional company) · prototype receipt, not a tax invoice', size: 8 },
        { type: 'spacer', height: 8 },
        {
          type: 'fields',
          columns: 2,
          items: [
            { label: 'Order', value: '{{order.orderNo}}' },
            { label: 'Registration', value: '{{order.regnNo}}' },
            { label: 'Paid on', value: '{{payment.date}}' },
            { label: 'Amount (₹)', value: '{{payment.amount}}' },
            { label: 'Transaction', value: '{{payment.txnId}}' },
            { label: 'Gateway reference', value: '{{payment.providerRef}}' },
          ],
        },
        { type: 'rule' },
        { type: 'table', source: 'lines', columns: [{ header: 'Item', value: '{{item}}', width: 3 }, { header: 'Amount (₹)', value: '{{amount}}', width: 1 }] },
        { type: 'text', text: 'Fitment: {{dealer.name}}, {{dealer.city}} on {{booking.slotDate}} at {{booking.slotStart}}', size: 9 },
      ],
    },
  },
];
