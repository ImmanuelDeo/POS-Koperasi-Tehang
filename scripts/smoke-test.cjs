const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const { app } = require('electron');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-koperasi-smoke-'));
process.env.FLO_USER_DATA_DIR = testDataDir;
fs.writeFileSync(path.join(testDataDir, 'flo.db'), '');

const {
  closeDatabase,
  createBackup,
  generateBillNumber,
  generateOrderNumber,
  getDatabase,
  initDatabase,
} = require('../dist/db');
const { billRoutes } = require('../dist/routes/bills');
const { catalogCsvRoutes } = require('../dist/routes/catalog-csv');
const { memberCsvRoutes } = require('../dist/routes/member-csv');
const { memberRoutes } = require('../dist/routes/members');
const { orderRoutes } = require('../dist/routes/orders');
const { productRoutes } = require('../dist/routes/products');
const { isOriginAllowed } = require('../dist/config/security');

let server;
let backupDb;

function authenticatedTestUser(req, _res, next) {
  req.user = {
    id: 'user-1',
    name: 'Smoke Test Owner',
    email: 'admin@koperasi.local',
    role: req.headers['x-smoke-role'] || 'owner',
    permissions: [],
  };
  next();
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function workbookColumnIndex(worksheet, name) {
  const headers = worksheet.getRow(1).values.slice(1).map((value) => String(value || '').trim().toLowerCase());
  const index = headers.indexOf(name);
  assert.notEqual(index, -1, `Workbook column '${name}' was not found`);
  return index + 1;
}

function findWorkbookRow(worksheet, columnName, value) {
  const column = workbookColumnIndex(worksheet, columnName);
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    if (String(worksheet.getCell(rowNumber, column).value || '') === String(value)) return rowNumber;
  }
  assert.fail(`Workbook row with ${columnName} '${value}' was not found`);
}

async function workbookPayload(workbook) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { xlsx_base64: buffer.toString('base64') };
}

async function createXlsxMemberPayload(employeeId, memberNo) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data Anggota');
  worksheet.addRow([
    'Nama Lengkap',
    'NIK (16 Digit)',
    'NIK Karyawan (Emp ID)',
    'Nomor Anggota',
    'Departemen / Divisi',
    'No HP / WhatsApp',
    'Email',
    'Alamat',
    'Limit Bulanan (Rp)',
    'Potong Gaji Aktif (0/1)',
    'Opt-in Promo WA (0/1)',
    'Catatan',
  ]);
  worksheet.addRow([
    'Member Smoke Test',
    '',
    employeeId,
    memberNo,
    'Umum',
    '',
    '',
    '',
    '0',
    '1',
    '0',
    '',
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { xlsx_base64: buffer.toString('base64') };
}

async function run() {
  initDatabase();
  const db = getDatabase();
  const testApp = express();
  testApp.use(express.json({ limit: '10mb' }));
  testApp.use('/api/catalog-csv', authenticatedTestUser, catalogCsvRoutes);
  testApp.use('/api/members', authenticatedTestUser, memberRoutes);
  testApp.use('/api/members-csv', authenticatedTestUser, memberCsvRoutes);
  testApp.use('/api/orders', authenticatedTestUser, orderRoutes);
  testApp.use('/api/bills', authenticatedTestUser, billRoutes);
  testApp.use('/api/products', authenticatedTestUser, productRoutes);

  assert.equal(isOriginAllowed(undefined, 3001), true);
  assert.equal(isOriginAllowed('http://localhost:3001', 3001), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3001', 3001), true);
  assert.equal(isOriginAllowed('http://192.168.1.10:3001', 3001), false);
  assert.equal(isOriginAllowed('https://attacker.example:3001', 3001), false);

  server = http.createServer(testApp);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const manualMember = await postJson(baseUrl, '/api/members', {
    name: 'Manual Smoke Member',
    member_no: 'SMOKE-MBR-MANUAL',
    employee_id: 'SMOKE-EMP-MANUAL',
    monthly_deduction_limit: 0,
    outstanding_deduction_limit: 0,
  });
  assert.equal(manualMember.status, 201, JSON.stringify(manualMember.body));

  const duplicateManualMember = await postJson(baseUrl, '/api/members', {
    name: 'Duplicate Smoke Member',
    member_no: 'smoke-mbr-manual',
  });
  assert.equal(duplicateManualMember.status, 409);
  assert.doesNotMatch(JSON.stringify(duplicateManualMember.body), /UNIQUE constraint failed/i);

  const deletableMember = await postJson(baseUrl, '/api/members', {
    name: 'Delete Smoke Member',
    member_no: 'SMOKE-MBR-DELETE',
  });
  assert.equal(deletableMember.status, 201, JSON.stringify(deletableMember.body));
  const deletedMemberResponse = await fetch(`${baseUrl}/api/members/${deletableMember.body.member.id}`, {
    method: 'DELETE',
  });
  assert.equal(deletedMemberResponse.status, 200, await deletedMemberResponse.text());
  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS count FROM customers WHERE id = ?').get(deletableMember.body.member.id).count,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'member.deleted' AND target_id = ?").get(deletableMember.body.member.id).count,
    1
  );

  const updatedMemberResponse = await fetch(`${baseUrl}/api/members/${manualMember.body.member.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Updated Smoke Member' }),
  });
  assert.equal(updatedMemberResponse.status, 200, await updatedMemberResponse.text());
  assert.equal(
    db.prepare("SELECT name FROM customers WHERE id = ?").get(manualMember.body.member.id).name,
    'Updated Smoke Member'
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'member.updated' AND target_id = ?").get(manualMember.body.member.id).count,
    1
  );

  const xlsxPayload = await createXlsxMemberPayload('SMOKE-EMP-XLSX', 'SMOKE-MBR-XLSX');
  const imported = await postJson(baseUrl, '/api/members-csv/import', xlsxPayload);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.result.created_members_count, 1);

  const duplicateImport = await postJson(baseUrl, '/api/members-csv/import', xlsxPayload);
  assert.equal(duplicateImport.status, 422);
  assert.doesNotMatch(JSON.stringify(duplicateImport.body), /UNIQUE constraint failed/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM customers WHERE employee_id = 'SMOKE-EMP-XLSX'").get().count, 1);

  const initialStockCount = db.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'initial_stock'").get().count;
  const rejectedProduct = await postJson(baseUrl, '/api/products', {
    name: 'Rollback Smoke Product',
    price: 2500,
    unit: 'smoke-rollback-unit',
    track_inventory: true,
    stock_quantity: 8,
    addon_group_ids: ['missing-addon-group', 'missing-addon-group'],
  });
  assert.equal(rejectedProduct.status, 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products WHERE name = 'Rollback Smoke Product'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM product_units WHERE name = 'smoke-rollback-unit'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'initial_stock'").get().count, initialStockCount);

  const productResponse = await postJson(baseUrl, '/api/products', {
    name: 'Smoke Test Product',
    price: 2500,
    unit: 'pcs',
    track_inventory: true,
    stock_quantity: 10,
  });
  assert.equal(productResponse.status, 201, JSON.stringify(productResponse.body));
  const productId = productResponse.body.product.id;
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId).stock_quantity, 10);
  assert.equal(db.prepare('SELECT movement_type FROM stock_movements WHERE product_id = ? AND reference_type = ?').get(productId, 'initial_stock').movement_type, 'initial');

  const failedProductUpdate = await fetch(`${baseUrl}/api/products/${productId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      track_inventory: true,
      stock_quantity: 4,
      addon_group_ids: ['missing-addon-group', 'missing-addon-group'],
    }),
  });
  assert.equal(failedProductUpdate.status, 500);
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId).stock_quantity, 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?').get(productId).count, 1);

  const updatedProductResponse = await fetch(`${baseUrl}/api/products/${productId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track_inventory: true, stock_quantity: 15 }),
  });
  assert.equal(updatedProductResponse.status, 200, await updatedProductResponse.text());
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId).stock_quantity, 15);
  assert.deepEqual(
    db.prepare('SELECT movement_type, quantity, balance_before, balance_after FROM stock_movements WHERE product_id = ? ORDER BY rowid').all(productId),
    [
      { movement_type: 'initial', quantity: 10, balance_before: 0, balance_after: 10 },
      { movement_type: 'adjustment', quantity: 5, balance_before: 10, balance_after: 15 },
    ]
  );

  const orderNumber = generateOrderNumber();
  const orderResult = db.prepare(`
    INSERT INTO orders (order_number, user_id, customer_id, status, total)
    VALUES (?, 'user-1', ?, 'pending', 2500)
  `).run(orderNumber, manualMember.body.member.id);
  const orderId = Number(orderResult.lastInsertRowid);

  const billNumber = generateBillNumber();
  const billResult = db.prepare(`
    INSERT INTO bills (bill_number, order_id, customer_id, subtotal, total, balance)
    VALUES (?, ?, ?, 2500, 2500, 2500)
  `).run(billNumber, orderId, manualMember.body.member.id);
  const billId = Number(billResult.lastInsertRowid);

  const payment = await postJson(baseUrl, `/api/bills/${billId}/payment`, {
    method: 'salary_deduction',
    amount: 2500,
    customer_id: manualMember.body.member.id,
  });
  assert.equal(payment.status, 200, JSON.stringify(payment.body));
  assert.equal(payment.body.salary_deduction.status, 'pending');
  assert.equal(payment.body.bill.payment_status, 'paid');
  assert.equal(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status,
    'completed'
  );
  assert.equal(
    db.prepare('SELECT created_by FROM salary_deductions WHERE bill_id = ?').get(billId).created_by,
    'user-1'
  );
  const deletedSalaryOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { method: 'DELETE' });
  assert.equal(deletedSalaryOrder.status, 200, await deletedSalaryOrder.text());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE id = ?').get(orderId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bills WHERE id = ?').get(billId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM salary_deductions WHERE bill_id = ?').get(billId).count, 0);
  const salaryOrderDeleteAudit = JSON.parse(db.prepare(
    "SELECT details FROM audit_logs WHERE action = 'DELETE_ORDER_TRANSACTION' AND target_id = ?"
  ).get(String(orderId)).details);
  assert.equal(salaryOrderDeleteAudit.order_number, orderNumber);
  assert.equal(Object.hasOwn(salaryOrderDeleteAudit, 'total'), false);

  const cashOrderId = Number(db.prepare(`
    INSERT INTO orders (order_number, user_id, status)
    VALUES (?, 'user-1', 'completed')
  `).run(generateOrderNumber()).lastInsertRowid);
  const paidCashBillId = Number(db.prepare(`
    INSERT INTO bills (bill_number, order_id, total, paid_amount, balance, payment_status)
    VALUES (?, ?, 1000, 1000, 0, 'paid')
  `).run(generateBillNumber(), cashOrderId).lastInsertRowid);
  const deletedPaidCashOrder = await fetch(`${baseUrl}/api/orders/${cashOrderId}`, { method: 'DELETE' });
  assert.equal(deletedPaidCashOrder.status, 200, await deletedPaidCashOrder.text());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE id = ?').get(cashOrderId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bills WHERE id = ?').get(paidCashBillId).count, 0);

  const deletableOrderNumber = generateOrderNumber();
  const deletableOrderId = Number(db.prepare(`
    INSERT INTO orders (order_number, user_id, status)
    VALUES (?, 'user-1', 'pending')
  `).run(deletableOrderNumber).lastInsertRowid);
  const deletableBillNumber = generateBillNumber();
  const deletableBillId = Number(db.prepare(`
    INSERT INTO bills (bill_number, order_id, total, balance)
    VALUES (?, ?, 1000, 1000)
  `).run(deletableBillNumber, deletableOrderId).lastInsertRowid);
  db.prepare('INSERT INTO print_jobs (id, bill_id) VALUES (?, ?)').run('smoke-print-job', deletableBillId);

  const deleted = await fetch(`${baseUrl}/api/orders/${deletableOrderId}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200, await deleted.text());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE id = ?').get(deletableOrderId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE id = ?').get('smoke-print-job').count, 0);
  assert.equal(generateOrderNumber(), `${deletableOrderNumber.slice(0, -4)}${String(Number(deletableOrderNumber.slice(-4)) + 1).padStart(4, '0')}`);
  assert.equal(generateBillNumber(), `${deletableBillNumber.slice(0, -4)}${String(Number(deletableBillNumber.slice(-4)) + 1).padStart(4, '0')}`);

  const expectedNextOrderNumber = generateOrderNumber();
  const createdOrder = await postJson(baseUrl, '/api/orders', {
    customer_id: manualMember.body.member.id,
    type: 'takeaway',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(createdOrder.status, 201, JSON.stringify(createdOrder.body));
  assert.equal(createdOrder.body.order.order_number, expectedNextOrderNumber);

  const expectedNextBillNumber = generateBillNumber();
  const generatedBill = await postJson(baseUrl, '/api/bills/generate', {
    order_id: createdOrder.body.order.id,
  });
  assert.equal(generatedBill.status, 201, JSON.stringify(generatedBill.body));
  assert.equal(generatedBill.body.bill.bill_number, expectedNextBillNumber);
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId).stock_quantity, 14);

  const deletedStockOrder = await fetch(`${baseUrl}/api/orders/${createdOrder.body.order.id}`, { method: 'DELETE' });
  assert.equal(deletedStockOrder.status, 200, await deletedStockOrder.text());
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId).stock_quantity, 15);
  const deletionMovement = db.prepare(
    "SELECT movement_type, quantity, reference_type FROM stock_movements WHERE product_id = ? ORDER BY rowid DESC LIMIT 1"
  ).get(productId);
  assert.equal(deletionMovement.movement_type, 'void');
  assert.equal(deletionMovement.quantity, 1);
  assert.equal(deletionMovement.reference_type, 'order_deletion');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bills WHERE id = ?').get(generatedBill.body.bill.id).count, 0);

  const deletedProductResponse = await fetch(`${baseUrl}/api/products/${productId}`, { method: 'DELETE' });
  assert.equal(deletedProductResponse.status, 200, await deletedProductResponse.text());
  assert.equal(db.prepare('SELECT deleted_at FROM products WHERE id = ?').get(productId).deleted_at !== null, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?').get(productId).count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?').get(createdOrder.body.order.id).count, 0);

  const bulkProduct = await postJson(baseUrl, '/api/products', {
    name: 'Bulk Workbook Product',
    price: 2000,
    unit: 'pcs',
    track_inventory: true,
    stock_quantity: 8,
  });
  assert.equal(bulkProduct.status, 201, JSON.stringify(bulkProduct.body));
  const bulkDeletedProduct = await postJson(baseUrl, '/api/products', {
    name: 'Bulk Workbook Delete Product',
    price: 1000,
    unit: 'pcs',
    track_inventory: false,
    stock_quantity: 0,
  });
  assert.equal(bulkDeletedProduct.status, 201, JSON.stringify(bulkDeletedProduct.body));

  const productExportResponse = await fetch(`${baseUrl}/api/catalog-csv/export-all`, { headers: { 'x-smoke-role': 'owner' } });
  assert.equal(productExportResponse.status, 200);
  const productWorkbook = new ExcelJS.Workbook();
  await productWorkbook.xlsx.load(Buffer.from(await productExportResponse.arrayBuffer()));
  const productSheet = productWorkbook.worksheets[0];
  assert.equal(productSheet.getRow(1).getCell(1).value, 'id');
  const bulkProductRow = findWorkbookRow(productSheet, 'id', bulkProduct.body.product.id);
  productSheet.getCell(bulkProductRow, workbookColumnIndex(productSheet, 'name')).value = 'Updated via Workbook';
  productSheet.getCell(bulkProductRow, workbookColumnIndex(productSheet, 'selling_price')).value = 2500;
  productSheet.getCell(bulkProductRow, workbookColumnIndex(productSheet, 'allow_decimal')).value = 1;
  productSheet.getCell(bulkProductRow, workbookColumnIndex(productSheet, 'stock_quantity')).value = 6.5;
  const bulkDeleteProductRow = findWorkbookRow(productSheet, 'id', bulkDeletedProduct.body.product.id);
  productSheet.getCell(bulkDeleteProductRow, workbookColumnIndex(productSheet, 'action')).value = 'DELETE';

  const productPreview = await postJson(baseUrl, '/api/catalog-csv/bulk-preview', await workbookPayload(productWorkbook));
  assert.equal(productPreview.status, 200, JSON.stringify(productPreview.body));
  assert.equal(productPreview.body.valid, true, JSON.stringify(productPreview.body.errors));
  assert.equal(productPreview.body.delete_count, 1);
  assert.equal(productPreview.body.update_count > 0, true);
  const productImport = await postJson(baseUrl, '/api/catalog-csv/bulk-import', await workbookPayload(productWorkbook));
  assert.equal(productImport.status, 200, JSON.stringify(productImport.body));
  assert.deepEqual(db.prepare('SELECT name, price, stock_quantity FROM products WHERE id = ?').get(bulkProduct.body.product.id), {
    name: 'Updated via Workbook',
    price: 2500,
    stock_quantity: 6.5,
  });
  assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS deleted FROM products WHERE id = ?').get(bulkDeletedProduct.body.product.id).deleted, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ? AND reference_type = 'excel_bulk_update' AND quantity = -1.5")
      .get(bulkProduct.body.product.id).count,
    1
  );

  const bulkUpdateMember = await postJson(baseUrl, '/api/members', {
    name: 'Bulk Workbook Member A',
    member_no: 'SMOKE-BULK-MBR-A',
    employee_id: 'SMOKE-BULK-EMP-A',
    monthly_deduction_limit: 10000,
    outstanding_deduction_limit: 20000,
  });
  const bulkSwapMember = await postJson(baseUrl, '/api/members', {
    name: 'Bulk Workbook Member B',
    member_no: 'SMOKE-BULK-MBR-B',
    employee_id: 'SMOKE-BULK-EMP-B',
    monthly_deduction_limit: 10000,
    outstanding_deduction_limit: 20000,
  });
  const bulkDeleteMember = await postJson(baseUrl, '/api/members', {
    name: 'Bulk Workbook Delete Member',
    member_no: 'SMOKE-BULK-MBR-DELETE',
    employee_id: 'SMOKE-BULK-EMP-DELETE',
  });
  const bulkArchiveMember = await postJson(baseUrl, '/api/members', {
    name: 'Bulk Workbook Archive Member',
    member_no: 'SMOKE-BULK-MBR-ARCHIVE',
    employee_id: 'SMOKE-BULK-EMP-ARCHIVE',
  });
  for (const result of [bulkUpdateMember, bulkSwapMember, bulkDeleteMember, bulkArchiveMember]) {
    assert.equal(result.status, 201, JSON.stringify(result.body));
  }
  const archiveOrderNumber = generateOrderNumber();
  const archiveOrderId = Number(db.prepare(`
    INSERT INTO orders (order_number, user_id, customer_id, status)
    VALUES (?, 'user-1', ?, 'completed')
  `).run(archiveOrderNumber, bulkArchiveMember.body.member.id).lastInsertRowid);
  assert.equal(archiveOrderId > 0, true);

  const deniedMemberExport = await fetch(`${baseUrl}/api/members-csv/export-all`, { headers: { 'x-smoke-role': 'cashier' } });
  assert.equal(deniedMemberExport.status, 403);
  const memberExportResponse = await fetch(`${baseUrl}/api/members-csv/export-all`, { headers: { 'x-smoke-role': 'office_hr' } });
  assert.equal(memberExportResponse.status, 200);
  const memberWorkbook = new ExcelJS.Workbook();
  const memberExportBuffer = Buffer.from(await memberExportResponse.arrayBuffer());
  await memberWorkbook.xlsx.load(memberExportBuffer);
  const memberSheet = memberWorkbook.worksheets[0];
  assert.equal(memberSheet.getRow(1).getCell(1).value, 'id');
  const updateMemberRow = findWorkbookRow(memberSheet, 'id', bulkUpdateMember.body.member.id);
  const swapMemberRow = findWorkbookRow(memberSheet, 'id', bulkSwapMember.body.member.id);
  const invalidMemberWorkbook = new ExcelJS.Workbook();
  await invalidMemberWorkbook.xlsx.load(memberExportBuffer);
  const invalidMemberSheet = invalidMemberWorkbook.worksheets[0];
  invalidMemberSheet.getCell(
    findWorkbookRow(invalidMemberSheet, 'id', bulkUpdateMember.body.member.id),
    workbookColumnIndex(invalidMemberSheet, 'employee_id')
  ).value = 'SMOKE-BULK-EMP-DUPLICATE';
  invalidMemberSheet.getCell(
    findWorkbookRow(invalidMemberSheet, 'id', bulkSwapMember.body.member.id),
    workbookColumnIndex(invalidMemberSheet, 'employee_id')
  ).value = 'SMOKE-BULK-EMP-DUPLICATE';
  const invalidMemberPreview = await postJson(baseUrl, '/api/members-csv/bulk-preview', await workbookPayload(invalidMemberWorkbook));
  assert.equal(invalidMemberPreview.status, 200);
  assert.equal(invalidMemberPreview.body.valid, false);
  const invalidMemberImport = await postJson(baseUrl, '/api/members-csv/bulk-import', await workbookPayload(invalidMemberWorkbook));
  assert.equal(invalidMemberImport.status, 422);
  assert.doesNotMatch(JSON.stringify(invalidMemberImport.body), /UNIQUE constraint failed/i);
  assert.equal(db.prepare('SELECT employee_id FROM customers WHERE id = ?').get(bulkUpdateMember.body.member.id).employee_id, 'SMOKE-BULK-EMP-A');

  memberSheet.getCell(updateMemberRow, workbookColumnIndex(memberSheet, 'employee_id')).value = 'SMOKE-BULK-EMP-B';
  memberSheet.getCell(swapMemberRow, workbookColumnIndex(memberSheet, 'employee_id')).value = 'SMOKE-BULK-EMP-A';
  memberSheet.getCell(updateMemberRow, workbookColumnIndex(memberSheet, 'monthly_deduction_limit')).value = 75000;
  memberSheet.getCell(updateMemberRow, workbookColumnIndex(memberSheet, 'outstanding_deduction_limit')).value = 125000;
  const omittedDeleteRow = findWorkbookRow(memberSheet, 'id', bulkDeleteMember.body.member.id);
  memberSheet.spliceRows(omittedDeleteRow, 1);
  const memberPreview = await postJson(baseUrl, '/api/members-csv/bulk-preview', await workbookPayload(memberWorkbook));
  assert.equal(memberPreview.status, 200, JSON.stringify(memberPreview.body));
  assert.equal(memberPreview.body.valid, true, JSON.stringify(memberPreview.body.errors));
  const memberImport = await postJson(baseUrl, '/api/members-csv/bulk-import', await workbookPayload(memberWorkbook));
  assert.equal(memberImport.status, 200, JSON.stringify(memberImport.body));
  assert.deepEqual(db.prepare('SELECT monthly_deduction_limit, outstanding_deduction_limit FROM customers WHERE id = ?').get(bulkUpdateMember.body.member.id), {
    monthly_deduction_limit: 75000,
    outstanding_deduction_limit: 125000,
  });
  assert.equal(db.prepare('SELECT employee_id FROM customers WHERE id = ?').get(bulkUpdateMember.body.member.id).employee_id, 'SMOKE-BULK-EMP-B');
  assert.equal(db.prepare('SELECT employee_id FROM customers WHERE id = ?').get(bulkSwapMember.body.member.id).employee_id, 'SMOKE-BULK-EMP-A');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers WHERE id = ?').get(bulkDeleteMember.body.member.id).count, 1);

  const deleteWorkbookResponse = await fetch(`${baseUrl}/api/members-csv/export-all`, { headers: { 'x-smoke-role': 'owner' } });
  const deleteWorkbook = new ExcelJS.Workbook();
  await deleteWorkbook.xlsx.load(Buffer.from(await deleteWorkbookResponse.arrayBuffer()));
  const deleteSheet = deleteWorkbook.worksheets[0];
  deleteSheet.getCell(findWorkbookRow(deleteSheet, 'id', bulkDeleteMember.body.member.id), workbookColumnIndex(deleteSheet, 'action')).value = 'DELETE';
  deleteSheet.getCell(findWorkbookRow(deleteSheet, 'id', bulkArchiveMember.body.member.id), workbookColumnIndex(deleteSheet, 'action')).value = 'DELETE';
  const deleteMemberPreview = await postJson(baseUrl, '/api/members-csv/bulk-preview', await workbookPayload(deleteWorkbook));
  assert.equal(deleteMemberPreview.status, 200, JSON.stringify(deleteMemberPreview.body));
  assert.equal(deleteMemberPreview.body.valid, true, JSON.stringify(deleteMemberPreview.body.errors));
  assert.equal(deleteMemberPreview.body.delete_count, 2);
  const deleteMemberImport = await postJson(baseUrl, '/api/members-csv/bulk-import', await workbookPayload(deleteWorkbook));
  assert.equal(deleteMemberImport.status, 200, JSON.stringify(deleteMemberImport.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers WHERE id = ?').get(bulkDeleteMember.body.member.id).count, 0);
  assert.deepEqual(db.prepare('SELECT is_active, salary_deduction_enabled, member_no FROM customers WHERE id = ?').get(bulkArchiveMember.body.member.id), {
    is_active: 0,
    salary_deduction_enabled: 0,
    member_no: 'SMOKE-BULK-MBR-ARCHIVE',
  });

  const backupPath = await createBackup();
  backupDb = new Database(backupPath, { readonly: true });
  assert.deepEqual(backupDb.pragma('quick_check'), [{ quick_check: 'ok' }]);

  console.log('Smoke tests passed: atomic member/product create/update, editable bulk XLSX export/import and delete, unique identifier swaps, safe member archival, stock ledger adjustments, member import, loopback CORS, financial order deletion, order history, and SQLite backup.');
}

run()
  .catch((error) => {
    console.error('Smoke tests failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (backupDb) backupDb.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      closeDatabase();
    } catch (error) {
      console.error('Failed to close smoke-test database cleanly:', error);
      process.exitCode = 1;
    }
    fs.rmSync(testDataDir, { recursive: true, force: true });
    app.quit();
  });
