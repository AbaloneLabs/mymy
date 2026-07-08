import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_DATE_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "TODAY",
    signature: "TODAY()",
    description: "Returns the current date as an Excel serial number.",
    category: "Date",
  },
  {
    name: "NOW",
    signature: "NOW()",
    description: "Returns the current date and time as an Excel serial number.",
    category: "Date",
  },
  {
    name: "DATE",
    signature: "DATE(year, month, day)",
    description: "Builds an Excel date serial number.",
    category: "Date",
  },
  {
    name: "YEAR",
    signature: "YEAR(serial_number)",
    description: "Returns the year from an Excel date serial number.",
    category: "Date",
  },
  {
    name: "MONTH",
    signature: "MONTH(serial_number)",
    description: "Returns the month from an Excel date serial number.",
    category: "Date",
  },
  {
    name: "DAY",
    signature: "DAY(serial_number)",
    description: "Returns the day of month from an Excel date serial number.",
    category: "Date",
  },
  {
    name: "HOUR",
    signature: "HOUR(serial_number)",
    description: "Returns the hour from an Excel date/time serial number.",
    category: "Date",
  },
  {
    name: "MINUTE",
    signature: "MINUTE(serial_number)",
    description: "Returns the minute from an Excel date/time serial number.",
    category: "Date",
  },
  {
    name: "SECOND",
    signature: "SECOND(serial_number)",
    description: "Returns the second from an Excel date/time serial number.",
    category: "Date",
  },
  {
    name: "DAYS",
    signature: "DAYS(end_date, start_date)",
    description: "Returns the number of days between two date serial numbers.",
    category: "Date",
  },
  {
    name: "TIME",
    signature: "TIME(hour, minute, second)",
    description: "Returns an Excel time serial fraction.",
    category: "Date",
  },
  {
    name: "DATEVALUE",
    signature: "DATEVALUE(date_text)",
    description: "Converts date text to an Excel date serial number.",
    category: "Date",
  },
  {
    name: "WEEKDAY",
    signature: "WEEKDAY(serial_number, [return_type])",
    description: "Returns the day of week for a date serial.",
    category: "Date",
  },
  {
    name: "EOMONTH",
    signature: "EOMONTH(start_date, months)",
    description: "Returns the serial date for the last day of a month offset.",
    category: "Date",
  },
];
