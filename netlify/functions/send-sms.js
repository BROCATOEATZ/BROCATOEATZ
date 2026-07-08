var SLOT_PIZZA_CAP = 4; // must match SLOT_PIZZA_CAP in index.html

function formatDate(isoString) {
  var d = new Date(isoString);
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var hours = d.getHours();
  var mins = String(d.getMinutes()).padStart(2,'0');
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + hours + ':' + mins + ' ' + ampm;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  if (data.type === 'order') {
    var result = addOrder(data);
    if (result.success) addToSignups(data);
    return jsonResponse(result);
  }

  if (data.type === 'cancel_order') {
    var cancelResult = cancelOrderByNum(data.orderNum);
    return jsonResponse(cancelResult);
  }

  if (data.type === 'clear_orders') {
    clearAllOrders();
    return jsonResponse({ success: true });
  }

  // default: signup
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sign Ups');
  sheet.appendRow([data.fname, data.lname, data.phone, formatDate(new Date().toISOString())]);
  return jsonResponse({ success: true });
}

// Reads current per-slot pizza totals from the sheet, keyed by exact slot
// text (e.g. "1:00 PM"). A split order contributes its qty to each of its
// individual slots, since each chunk is now stored as its own row.
function getSlotTotals() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders 7/5');
  var lastRow = sheet.getLastRow();
  var totals = {};
  if (lastRow < 2) return totals;

  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues(); // OrderNum..Phone, includes Pizzas col
  for (var i = 0; i < rows.length; i++) {
    var rowSlot = String(rows[i][1] || '').replace(/^'/, '');
    var qty = Number(rows[i][5]) || 0;
    if (!rowSlot) continue;
    totals[rowSlot] = (totals[rowSlot] || 0) + qty;
  }
  return totals;
}

// Finds the highest existing orderNum in the sheet and returns the next
// integer. Only ever called from inside addOrder()'s lock (see below), so
// two concurrent requests can never read the same "current max" and thus
// can never compute the same next number.
function getNextOrderNum(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  var col = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < col.length; i++) {
    var n = Number(col[i][0]);
    if (n > max) max = n;
  }
  return max + 1;
}

// Re-checks slot capacity using the CURRENT state of the sheet (not whatever
// the customer's browser last saw). Handles orders that span multiple slots:
// each slot-chunk is checked against ITS OWN remaining capacity, and if every
// chunk fits, the order is written as multiple rows (one per slot-chunk),
// all sharing the same orderNum so they're still recognized as one order.
//
// IMPORTANT: the order number is assigned HERE, server-side, inside a
// script lock — never trust data.orderNum from the client. Two customers
// submitting within milliseconds of each other used to be able to compute
// the same orderNum client-side, which caused the second order's rows to
// silently get grouped into the first order in doGet() (merged pizza
// counts, first customer's name/phone kept, second customer's order
// effectively disappearing from the admin view). The lock below makes that
// impossible: only one addOrder() call can read-and-increment the max
// order number at a time.
function addOrder(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // wait up to 30s for the lock rather than fail during a busy drop

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders 7/5');

    // Use the real per-slot breakdown if provided; otherwise fall back to
    // treating the whole order as a single slot/qty (older clients).
    var chunks = (data.slots && data.slots.length)
      ? data.slots
      : [{ slot: data.slotDisplay || data.slot, qty: Number(data.pizzaCount) || 0 }];

    var slotTotals = getSlotTotals();

    // Validate EVERY chunk fits in its OWN slot before writing anything.
    for (var i = 0; i < chunks.length; i++) {
      var slotName = chunks[i].slot;
      var qty = Number(chunks[i].qty) || 0;
      var already = slotTotals[slotName] || 0;
      if (already + qty > SLOT_PIZZA_CAP) {
        return { success: false, error: 'slot_full', slot: slotName };
      }
    }

    // Assign the real, unique order number now that capacity is confirmed
    // and we're safely inside the lock.
    var orderNum = getNextOrderNum(sheet);

    // All chunks fit — write one row per chunk. Pizza-type breakdown
    // (margherita/cupchar/etc) is attributed to the FIRST chunk only, since
    // the cart doesn't track which specific pizza went into which slot; this
    // keeps pizza-type totals accurate overall while still tracking accurate
    // per-slot pizza COUNTS for capacity purposes.
    var pizzas = data.pizzas || [];
    var getQty = function(id) {
      var p = pizzas.filter(function(x){ return x.id === id; })[0];
      return p ? p.qty : 0;
    };

    for (var j = 0; j < chunks.length; j++) {
      var isFirst = (j === 0);
      var slotTextSafe = "'" + chunks[j].slot; // force plain text, prevent Sheets auto-date conversion

      sheet.appendRow([
        orderNum,
        slotTextSafe,
        data.fname,
        data.lname,
        data.phone,
        chunks[j].qty,
        isFirst ? getQty('margherita') : 0,
        isFirst ? getQty('cupchar') : 0,
        isFirst ? getQty('funguy') : 0,
        isFirst ? getQty('calabrian') : 0,
        isFirst ? (data.brownie || 0) : 0,
        isFirst ? data.total : 0,
        isFirst ? (data.notes || '') : ('(split, see order #' + orderNum + ')'),
        formatDate(data.ts)
      ]);
    }

    return { success: true, orderNum: orderNum };
  } finally {
    lock.releaseLock();
  }
}

function cancelOrderByNum(orderNum) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders 7/5');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'no_orders' };

  // An order may span multiple rows (split across slots) sharing the same
  // orderNum, so delete ALL matching rows, not just the first match.
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var rowsToDelete = [];
  for (var i = 0; i < values.length; i++) {
    if (Number(values[i][0]) === Number(orderNum)) {
      rowsToDelete.push(i + 2); // +2: skip header row, account for 0-index
    }
  }
  if (rowsToDelete.length === 0) return { success: false, error: 'not_found' };

  // Delete from the bottom up so row indices don't shift under us.
  rowsToDelete.sort(function(a,b){ return b - a; });
  rowsToDelete.forEach(function(rowNum){ sheet.deleteRow(rowNum); });

  return { success: true };
}

function clearAllOrders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders 7/5');
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.deleteRows(2, lastRow - 1);
  }
}

function addToSignups(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sign Ups');
  var phone = data.phone;
  var existing = sheet.getDataRange().getValues();
  for(var i = 1; i < existing.length; i++) {
    if(existing[i][2] === phone) return;
  }
  sheet.appendRow([data.fname, data.lname, data.phone, formatDate(new Date().toISOString())]);
}

// Returns ORDERS grouped back by orderNum (re-merging split rows into one
// logical order) for the admin panel and slot-capacity math on the front end.
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders 7/5');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return jsonResponse({ orders: [] });
  }

  var rows = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  // Raw per-row data (one row per slot-chunk)
  var rawRows = rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      return {
        orderNum: r[0],
        slotDisplay: String(r[1] || '').replace(/^'/, ''),
        fname: r[2],
        lname: r[3],
        phone: r[4],
        pizzaCount: r[5],
        margherita: r[6],
        cupchar: r[7],
        funguy: r[8],
        calabrian: r[9],
        brownie: r[10],
        total: r[11],
        notes: r[12],
        timestamp: r[13]
      };
    });

  // Group rows sharing the same orderNum back into one logical order, with
  // a `slots` breakdown array so the front end can do accurate per-slot math.
  var grouped = {};
  var order = [];
  rawRows.forEach(function (r) {
    if (!grouped[r.orderNum]) {
      grouped[r.orderNum] = Object.assign({}, r, {
        slots: [],
        pizzaCount: 0,
        margherita: 0, cupchar: 0, funguy: 0, calabrian: 0,
        brownie: 0, total: 0
      });
      order.push(r.orderNum);
    }
    var o = grouped[r.orderNum];
    o.slots.push({ slot: r.slotDisplay, qty: Number(r.pizzaCount) || 0 });
    o.pizzaCount += Number(r.pizzaCount) || 0;
    o.margherita += Number(r.margherita) || 0;
    o.cupchar += Number(r.cupchar) || 0;
    o.funguy += Number(r.funguy) || 0;
    o.calabrian += Number(r.calabrian) || 0;
    o.brownie += Number(r.brownie) || 0;
    o.total += Number(r.total) || 0;
    // keep the first row's slotDisplay as the "primary" display string
  });

  var orders = order.map(function(num){
    var o = grouped[num];
    // Build a readable combined display for split orders, e.g. "1:00 PM (3) + 1:20 PM (2)"
    o.slotDisplay = o.slots.length > 1
      ? o.slots.map(function(s){ return s.slot + ' (' + s.qty + ')'; }).join(' + ')
      : o.slots[0].slot;
    return o;
  });

  return jsonResponse({ orders: orders });
}
