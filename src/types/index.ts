type ColumnType = "number" | "date" | "string";

interface DataRow {
  id: string;
  [key: string]: any;
}

interface ColumnDef {
  keyName: string;
  label: string;
  type: ColumnType;
  width: number;
}

interface ParsedSheet {
  name: string;
  rows: DataRow[];
  columns: ColumnDef[];
  rowCount: number;
  columnCount: number;
}

interface Dataset {
  id: string;
  name: string;
  rows: DataRow[];
  columns: ColumnDef[];
  createAt: number;
  rowCount: number;
  columnCount: number;
}

export type { DataRow, ColumnDef, ColumnType, ParsedSheet, Dataset };
