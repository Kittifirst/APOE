(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WheelEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_ITEMS = 30;
  var MAX_SEGMENTS = 60;
  var MAX_WEIGHT = 1000;
  var MAX_QUANTITY = 999999;
  var DEFAULT_SETTINGS = Object.freeze({
    equalChance: false,
    items: Object.freeze([
      Object.freeze({ id: 'discount-10', label: 'ส่วนลด 10%', quantity: 1, weight: 30, color: '#C47C54' }),
      Object.freeze({ id: 'free-drink', label: 'เครื่องดื่มฟรี', quantity: 1, weight: 20, color: '#E8C587' }),
      Object.freeze({ id: 'try-again', label: 'ลองใหม่อีกครั้ง', quantity: 1, weight: 25, color: '#788568' }),
      Object.freeze({ id: 'discount-20', label: 'ส่วนลด 20%', quantity: 1, weight: 15, color: '#BB7045' }),
      Object.freeze({ id: 'special-prize', label: 'ของรางวัลพิเศษ', quantity: 1, weight: 8, color: '#95604A' }),
      Object.freeze({ id: 'jackpot', label: 'แจ็กพอต', quantity: 1, weight: 2, color: '#DAC19B' })
    ])
  });

  /** Validate persisted settings without coercing strings or changing the input. */
  function validateSettings(settings) {
    var errors = [];
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { valid: false, errors: ['ข้อมูลตั้งค่าวงล้อไม่ถูกต้อง'] };
    }
    if (typeof settings.equalChance !== 'boolean') {
      errors.push('กรุณาระบุโหมดโอกาสเท่ากันทุกช่องเป็นเปิดหรือปิด');
    }
    if (!Array.isArray(settings.items)) {
      errors.push('รายการบนวงล้อต้องเป็นรายการข้อมูล');
      return { valid: false, errors: errors };
    }
    if (settings.items.length < 1 || settings.items.length > MAX_ITEMS) {
      errors.push('วงล้อต้องมีรายการรางวัลตั้งแต่ 1 ถึง ' + MAX_ITEMS + ' รายการ');
    }

    var ids = new Set();
    var totalWeight = 0;
    settings.items.forEach(function (item, index) {
      var prefix = 'รายการที่ ' + (index + 1) + ': ';
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(prefix + 'ข้อมูลรางวัลไม่ถูกต้อง');
        return;
      }
      if (typeof item.id !== 'string' || !item.id.trim()) {
        errors.push(prefix + 'ต้องมีรหัสรางวัล');
      } else if (ids.has(item.id.trim())) {
        errors.push(prefix + 'รหัสรางวัลซ้ำกัน');
      } else {
        ids.add(item.id.trim());
      }
      if (typeof item.label !== 'string' || !item.label.trim() || Array.from(item.label.trim()).length > 60) {
        errors.push(prefix + 'ชื่อรางวัลต้องมีความยาว 1–60 ตัวอักษร');
      }
      var validQuantity = Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= MAX_QUANTITY;
      var validWeight = Number.isFinite(item.weight) && item.weight >= 0 && item.weight <= MAX_WEIGHT;
      if (!validQuantity) {
        errors.push(prefix + 'จำนวนชิ้นทั้งหมดต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ' + MAX_QUANTITY);
      }
      if (!validWeight) {
        errors.push(prefix + 'น้ำหนักการออกต้องเป็นตัวเลขตั้งแต่ 0 ถึง ' + MAX_WEIGHT);
      }
      if (validQuantity && validWeight) totalWeight += item.quantity * item.weight;
      if (typeof item.color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(item.color)) {
        errors.push(prefix + 'สีต้องเป็นรหัส Hex เช่น #C47C54');
      }
    });

    if (errors.length === 0 && !settings.equalChance && totalWeight <= 0) {
      errors.push('โหมดสุ่มตามเรทต้องมีอย่างน้อยหนึ่งรางวัลที่น้ำหนักมากกว่า 0');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // Geometry and probability inspection accept either settings or the items array.
  // Zero total weight is valid here; selecting a weighted result still rejects it.
  function checkedItems(settingsOrItems) {
    var items = Array.isArray(settingsOrItems) ? settingsOrItems : settingsOrItems && settingsOrItems.items;
    var validation = validateSettings({ equalChance: true, items: items });
    if (!validation.valid) throw new RangeError(validation.errors.join('\n'));
    return items;
  }

  /** Stock totals are independent of removable log rows. */
  function issuedCount(item, issued) {
    var count = issued && Object.prototype.hasOwnProperty.call(issued, item.id.trim()) ? issued[item.id.trim()] : 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('ยอดจ่ายรางวัลไม่ถูกต้อง');
    return count;
  }

  function remainingCount(item, issued) {
    return Math.max(0, item.quantity - issuedCount(item, issued));
  }

  /** One visual slice per prize type, never one slice per physical piece. */
  function buildSegments(settingsOrItems, issued) {
    var items = checkedItems(settingsOrItems);
    var equalChance = !Array.isArray(settingsOrItems) && settingsOrItems.equalChance === true;
    var segments = [];
    items.forEach(function (item, itemIndex) {
      var remaining = remainingCount(item, issued);
      if (!remaining) return;
      segments.push({
        id: item.id.trim(),
        label: item.label.trim(),
        color: item.color,
        weight: remaining * (equalChance ? 1 : item.weight),
        configuredWeight: item.weight,
        remaining: remaining,
        itemIndex: itemIndex,
        index: segments.length
      });
    });
    return segments;
  }

  /** Preserve equal chance per remaining physical piece without duplicating slices. */
  function probabilities(settingsOrItems, issued) {
    var items = checkedItems(settingsOrItems);
    var equalChance = !Array.isArray(settingsOrItems) && settingsOrItems.equalChance === true;
    var total = items.reduce(function (sum, item) {
      return sum + remainingCount(item, issued) * (equalChance ? 1 : item.weight);
    }, 0);
    return items.map(function (item) {
      var remaining = remainingCount(item, issued);
      var effectiveWeight = equalChance ? 1 : item.weight;
      var probability = total > 0 ? remaining * effectiveWeight / total : 0;
      return {
        id: item.id.trim(), label: item.label.trim(), quantity: item.quantity,
        issued: issuedCount(item, issued), remaining: remaining,
        weight: item.weight, effectiveWeight: effectiveWeight,
        probability: probability, percent: probability * 100
      };
    });
  }

  /** Return an array index. rng must return a finite number in [0, 1). */
  function chooseWeightedSegment(segments, rng) {
    if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
      throw new RangeError('ต้องมีช่องบนวงล้อตั้งแต่ 1 ถึง ' + MAX_SEGMENTS + ' ช่อง');
    }
    var total = 0;
    var lastPositiveIndex = -1;
    segments.forEach(function (segment, index) {
      if (!segment || !Number.isFinite(segment.weight) || segment.weight < 0 || segment.weight > MAX_WEIGHT * MAX_QUANTITY) {
        throw new RangeError('น้ำหนักช่องบนวงล้อไม่ถูกต้อง');
      }
      total += segment.weight;
      if (segment.weight > 0) lastPositiveIndex = index;
    });
    if (total <= 0) throw new RangeError('ต้องมีอย่างน้อยหนึ่งช่องที่น้ำหนักมากกว่า 0');
    var random = (rng === undefined ? Math.random : rng)();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError('ค่าการสุ่มต้องอยู่ระหว่าง 0 ถึงน้อยกว่า 1');
    }
    var target = random * total;
    var cumulative = 0;
    for (var index = 0; index < segments.length; index += 1) {
      cumulative += segments[index].weight;
      if (segments[index].weight > 0 && target < cumulative) return index;
    }
    // Floating-point multiplication may round a value just below total up to total.
    // This fallback can only select a positive-weight segment.
    return lastPositiveIndex;
  }

  function checkRotationAndCount(rotation, count) {
    if (!Number.isFinite(rotation)) throw new RangeError('มุมหมุนต้องเป็นตัวเลขที่มีค่าจำกัด');
    if (!Number.isInteger(count) || count < 1 || count > MAX_SEGMENTS) {
      throw new RangeError('จำนวนช่องต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ' + MAX_SEGMENTS);
    }
  }

  function normalizeDegrees(rotation) {
    return ((rotation % 360) + 360) % 360;
  }

  /**
   * Segment 0 starts at -90° (top), segments run clockwise, CSS rotation is
   * clockwise, and the pointer stays at top. Boundaries belong to the segment
   * beginning at that boundary. Negative and multi-turn rotations are supported.
   */
  function pointerIndex(rotation, count) {
    checkRotationAndCount(rotation, count);
    return Math.min(count - 1, Math.floor(normalizeDegrees(-rotation) / (360 / count)));
  }

  /** Return an absolute clockwise rotation that centers the requested segment. */
  function rotationForSegment(currentRotation, segmentIndex, count, turns) {
    checkRotationAndCount(currentRotation, count);
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= count) {
      throw new RangeError('ตำแหน่งช่องอยู่นอกวงล้อ');
    }
    var completeTurns = turns === undefined ? 6 : turns;
    if (!Number.isInteger(completeTurns) || completeTurns < 0) {
      throw new RangeError('จำนวนรอบหมุนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
    }
    var desiredRotation = normalizeDegrees(-(segmentIndex + 0.5) * (360 / count));
    var delta = normalizeDegrees(desiredRotation - normalizeDegrees(currentRotation));
    var result = currentRotation + completeTurns * 360 + delta;
    if (!Number.isFinite(result)) throw new RangeError('มุมหมุนมากเกินไป');
    return result;
  }

  return Object.freeze({
    MAX_ITEMS: MAX_ITEMS,
    MAX_SEGMENTS: MAX_SEGMENTS,
    MAX_WEIGHT: MAX_WEIGHT,
    MAX_QUANTITY: MAX_QUANTITY,
    issuedCount: issuedCount,
    remainingCount: remainingCount,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    validateSettings: validateSettings,
    buildSegments: buildSegments,
    probabilities: probabilities,
    chooseWeightedSegment: chooseWeightedSegment,
    pointerIndex: pointerIndex,
    rotationForSegment: rotationForSegment
  });
});
