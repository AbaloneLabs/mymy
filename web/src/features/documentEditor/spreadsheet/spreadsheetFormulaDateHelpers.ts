export function excelSerialFromDate(date: Date) {
  return excelSerialFromDateParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
}

export function excelSerialFromDateTime(date: Date) {
  const dateSerial = excelSerialFromDate(date);
  const seconds =
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1000;
  return dateSerial + seconds / 86400;
}

export function excelSerialFromDateParts(year: number, month: number, day: number) {
  const date = Date.UTC(year, month - 1, day);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((date - epoch) / 86400000);
}

export function excelDateFromSerial(serial: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86400000);
}

export function excelSerialFromDateText(text: string) {
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return "#VALUE!";
  const date = new Date(timestamp);
  return excelSerialFromDateParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function spreadsheetFormulaWeekday(serial: number, returnType: number) {
  const day = excelDateFromSerial(serial).getUTCDay();
  const type = Math.trunc(returnType || 1);
  if (type === 2) return day === 0 ? 7 : day;
  if (type === 3) return day === 0 ? 6 : day - 1;
  return day + 1;
}

export function excelSerialEndOfMonth(startSerial: number, months: number) {
  const date = excelDateFromSerial(startSerial);
  const end = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + Math.trunc(months) + 1,
      0,
    ),
  );
  return excelSerialFromDateParts(
    end.getUTCFullYear(),
    end.getUTCMonth() + 1,
    end.getUTCDate(),
  );
}
