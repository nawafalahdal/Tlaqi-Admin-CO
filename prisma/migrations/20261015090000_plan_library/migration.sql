-- مركز الخطط: نبذةٌ واحدة، وموادُّ مرتَّبة — ملفٌّ مرفوع أو رابط
CREATE TYPE "PlanItemKind" AS ENUM ('file', 'link');

CREATE TABLE "PlanLibrary" (
    "id"            TEXT NOT NULL DEFAULT 'main',
    "intro"         TEXT NOT NULL DEFAULT '',
    "heading"       TEXT NOT NULL DEFAULT 'خطط تَـــلاقِ',
    "updatedByName" TEXT,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanLibrary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanDoc" (
    "id"             TEXT NOT NULL,
    "order"          INTEGER NOT NULL,
    "title"          TEXT NOT NULL,
    "note"           TEXT,
    "kind"           "PlanItemKind" NOT NULL,
    "fileName"       TEXT,
    "mimeType"       TEXT,
    "byteSize"       INTEGER,
    "data"           BYTEA,
    "linkUrl"        TEXT,
    "uploadedById"   TEXT,
    "uploadedByName" TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanDoc_pkey" PRIMARY KEY ("id")
);

-- المركز يُقرأ مرتَّباً دائماً
CREATE INDEX "PlanDoc_order_idx" ON "PlanDoc"("order");
