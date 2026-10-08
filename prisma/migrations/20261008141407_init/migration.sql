-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "installed" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "smsEvents" TEXT NOT NULL,
    "voiceEvents" TEXT NOT NULL,
    "templates" TEXT NOT NULL,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT NOT NULL DEFAULT '21:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '08:00',
    "quietHoursTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "stalledAfterDays" INTEGER NOT NULL DEFAULT 3,
    "optOutMessage" TEXT NOT NULL,
    "helpMessage" TEXT NOT NULL,
    "statusTemplate" TEXT NOT NULL,
    CONSTRAINT "ShopSettings_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopifySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT,
    "onlineAccessInfo" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerFirstName" TEXT,
    "customerId" TEXT,
    "email" TEXT,
    "customerPhone" TEXT,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "totalPrice" TEXT,
    "currency" TEXT,
    "orderStatusUrl" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "trackingCompany" TEXT,
    "statusSummary" TEXT,
    "stalledNotifiedAt" DATETIME,
    "shopifyCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "twilioSid" TEXT,
    "eventType" TEXT,
    "fromPhone" TEXT,
    "toPhone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OutboundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "twilioSid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ShopifySession_shop_idx" ON "ShopifySession"("shop");

-- CreateIndex
CREATE INDEX "OrderRecord_customerPhone_idx" ON "OrderRecord"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRecord_shop_shopifyOrderId_key" ON "OrderRecord"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "Message_shop_shopifyOrderId_idx" ON "Message"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "Message_fromPhone_idx" ON "Message"("fromPhone");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundJob_dedupeKey_key" ON "OutboundJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboundJob_status_nextAttemptAt_idx" ON "OutboundJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "OptOut_shop_phone_key" ON "OptOut"("shop", "phone");
