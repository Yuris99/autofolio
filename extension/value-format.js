// Shapes a saved value the way the field asks for it: the format named in its placeholder or
// title ("YYYY.MM.DD"), or an example there ("010-1234-5678", "HONG GILDONG", "1990.01.01").
// Loaded as a classic content script before content.js and imported by the Node tests, so it
// only assigns to globalThis. Only values that look like the example are changed.
(() => {
  const DATE_VALUE = /^(?:19|20)\d{2}\D?(?:0[1-9]|1[0-2])(?:\D?\d{2})?\D?$/;
  const PHONE_EXAMPLE = /(?<!\d)(0\d{1,2})([-. ]?)(\d{3,4})\2(\d{4})(?!\d)/;
  const DATE_EXAMPLE = /(?<!\d)(?:19|20)\d{2}([.\-/ ]?)(0[1-9]|1[0-2])(?:\1(0[1-9]|[12]\d|3[01]))?(?!\d)/;

  function formatDate(digits, hint, maxLength) {
    // Named formats: "YYYY.MM.DD", "yyyymm", "YYMMDD".
    const named = hint.match(/(y{2,4})(\W?)m{2}(?:(\W?)d{2})?/i);
    if (named) {
      const [whole, years, first, second = ""] = named;
      const year = years.length === 2 ? digits.slice(2, 4) : digits.slice(0, 4);
      return whole.toLowerCase().includes("dd") && digits.length === 8
        ? `${year}${first}${digits.slice(4, 6)}${second}${digits.slice(6, 8)}`
        : `${year}${first}${digits.slice(4, 6)}`;
    }
    // An example date: "1990.01.01", "2024-03", "19900101".
    const example = hint.match(DATE_EXAMPLE);
    if (example) {
      const [, separator, , day] = example;
      return day && digits.length === 8
        ? `${digits.slice(0, 4)}${separator}${digits.slice(4, 6)}${separator}${digits.slice(6, 8)}`
        : `${digits.slice(0, 4)}${separator}${digits.slice(4, 6)}`;
    }
    if (maxLength === digits.length) return digits;
    return null;
  }

  function formatPhone(digits, hint) {
    const example = hint.match(PHONE_EXAMPLE);
    if (!example) return null;
    const separator = example[2];
    const area = digits.startsWith("02") ? 2 : 3;
    return [digits.slice(0, area), digits.slice(area, -4), digits.slice(-4)].join(separator);
  }

  // "HONG GILDONG" → upper case, "Hong Gildong" → each word capitalized. Word order is left alone.
  function formatLatinName(value, hint) {
    const example = hint.match(/(?<![A-Za-z])[A-Za-z]+(?:[ ,-]+[A-Za-z]+)+(?![A-Za-z])/);
    if (!example) return null;
    const words = example[0].split(/[ ,-]+/);
    if (words.every(word => word === word.toUpperCase())) return value.toUpperCase();
    if (words.every(word => /^[A-Z][a-z]+$/.test(word))) return value.toLowerCase().replace(/(^|[\s,])([a-z])/g, (_, before, letter) => before + letter.toUpperCase());
    return null;
  }

  // hint: { type, text (placeholder, title, data-format, help text), current (value already in the box), maxLength }
  function formatValue(value, hint = {}) {
    value = String(value ?? "").trim();
    const { type = "text", text = "", current = "", maxLength = -1 } = hint;
    const digits = value.replace(/\D/g, "");
    if (type === "date" && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (type === "month" && digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
    if (!["text", "tel", "search", ""].includes(type)) return value;

    let shaped = null;
    if (DATE_VALUE.test(value)) {
      // A date already in the box shows the format too.
      const inBox = current.trim().match(/^\d{4}(\D)\d{2}(?:(\D)\d{2})?$/);
      const shown = inBox ? `yyyy${inBox[1]}mm${inBox[2] ? `${inBox[2]}dd` : ""}` : "";
      shaped = formatDate(digits, `${text} ${shown}`, maxLength);
    } else if (/^0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}$/.test(value)) {
      shaped = formatPhone(digits, text);
    } else if (/^[A-Za-z]+(?:[ ,-]+[A-Za-z]+)+$/.test(value)) {
      shaped = formatLatinName(value, text);
    }
    shaped ??= value;
    // Too long for the box, but fits without separators (a phone or date box with maxlength 11 / 8).
    if (maxLength > 0 && shaped.length > maxLength) {
      const bare = shaped.replace(/[-. /]/g, "");
      if (bare.length <= maxLength) shaped = bare;
    }
    return shaped;
  }

  // One value over boxes that split it: 010 | 1234 | 5678, id @ domain [domain list],
  // 1999 년 03 월 02 일. parts: [{ kind: "text" | "select", maxLength }]. Null when unsure.
  function splitValue(value, parts) {
    value = String(value ?? "").trim();
    const count = parts.length;
    const digits = value.replace(/\D/g, "");
    if (value.includes("@")) {
      const [local, domain] = value.split("@");
      // The last box may be a domain list next to a domain box: both get the domain.
      if (count === 2) return [local, domain];
      if (count === 3 && parts[2].kind === "select") return [local, domain, domain];
      return null;
    }
    if (/^0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}$/.test(value)) {
      const area = digits.startsWith("02") ? 2 : 3;
      const pieces = [digits.slice(0, area), digits.slice(area, -4), digits.slice(-4)];
      if (count === 3) return pieces;
      if (count === 2) return [pieces[0], pieces[1] + pieces[2]];
      return null;
    }
    if (DATE_VALUE.test(value)) {
      const pieces = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean);
      return count <= pieces.length && count >= 2 ? pieces.slice(0, count) : null;
    }
    const pieces = value.split(/\s*[-./]\s*|\s+/).filter(Boolean);
    if (pieces.length === count) return pieces;
    // Digits only, box sizes given: "123456" over 3 + 3.
    const sizes = parts.map(part => part.maxLength);
    if (/^\d+$/.test(value) && sizes.every(size => size > 0) && sizes.reduce((a, b) => a + b, 0) === value.length) {
      let at = 0;
      return sizes.map(size => value.slice(at, (at += size)));
    }
    return null;
  }

  globalThis.AutoFolioFormat = { formatValue, splitValue };
})();
