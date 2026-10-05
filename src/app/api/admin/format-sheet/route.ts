import { NextRequest, NextResponse } from "next/server";
import { formatBrandedSheet } from "@/lib/googleSheets";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.SHEET_FORMAT_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await formatBrandedSheet();
  return NextResponse.json(result);
}
