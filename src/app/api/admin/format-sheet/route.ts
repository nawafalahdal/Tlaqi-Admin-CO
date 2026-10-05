import { NextRequest, NextResponse } from "next/server";
import { formatBrandedSheet } from "@/lib/googleSheets";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.SHEET_FORMAT_TOKEN;
  if (!token || token !== expected) {
    return NextResponse.json(
      {
        error: "unauthorized",
        debug: {
          envConfigured: Boolean(expected),
          envLength: expected?.length ?? 0,
          receivedLength: token?.length ?? 0,
        },
      },
      { status: 401 }
    );
  }
  const result = await formatBrandedSheet();
  return NextResponse.json(result);
}
