require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { JWT } = require("google-auth-library");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

const GOOGLE_CREDENTIALS = JSON.parse(fs.readFileSync("credentials.json"));
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const STORES = process.env.SHOPIFY_STORES.split(",").map((store, index) => ({
    name: store.trim(),
    shopUrl: process.env[`SHOPIFY_STORE_${index + 1}_URL`],
    accessToken: process.env[`SHOPIFY_STORE_${index + 1}_ACCESS_TOKEN`]
}));

async function authenticateGoogleSheets() {
    const auth = new JWT({
        email: GOOGLE_CREDENTIALS.client_email,
        key: GOOGLE_CREDENTIALS.private_key.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

async function getChargebacks(shopUrl, accessToken) {
    try {
        const url = `https://${shopUrl}/admin/api/2025-01/shopify_payments/disputes.json`;
        const response = await axios.get(url, {
            headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json",
            },
        });
        const disputes = response.data.disputes || [];
        return disputes.map(dispute => ({
            Store: shopUrl,
            "Order ID": dispute.order_id || "N/A",
            "Dispute ID": dispute.id.toString(),
            Status: dispute.status,
            Amount: dispute.amount,
            Currency: dispute.currency,
            Reason: dispute.reason,
            "Initiated At": dispute.initiated_at,
            "Due At": dispute.evidence_due_by,
        }));
    } catch (error) {
        console.error(`❌ Error fetching chargebacks for ${shopUrl}:`, error.response?.data || error.message);
        return [];
    }
}

async function ensureSheet(doc, sheetName) {
    let sheet = doc.sheetsByTitle[sheetName];
    if (!sheet) {
        sheet = await doc.addSheet({
            title: sheetName,
            headerValues: ["Store", "Order ID", "Dispute ID", "Status", "Amount", "Currency", "Reason", "Initiated At", "Due At"]
        });
    } else {
        await sheet.loadHeaderRow();
    }
    return sheet;
}

async function updateChargebacks(sheet, chargebacks) {
    if (chargebacks.length === 0) return;

    const existingRows = await sheet.getRows();
    const existingChargebacks = new Map();

    existingRows.forEach(row => {
        const disputeID = row["Dispute ID"] ? row["Dispute ID"].toString() : "";
        if (disputeID) {
            existingChargebacks.set(disputeID, row);
        }
    });

    let newEntries = [];
    for (const cb of chargebacks) {
        const disputeID = cb["Dispute ID"].toString();
        
        if (existingChargebacks.has(disputeID)) {
            let existingRow = existingChargebacks.get(disputeID);
            
            if (existingRow.Status !== cb.Status) {
                existingRow.Status = cb.Status;
                await existingRow.save();
                console.log(`🔄 Updated status for Dispute ID ${disputeID}`);
            }
        } else {
            newEntries.push(cb);
        }
    }

    if (newEntries.length > 0) {
        console.log(`✅ Adding ${newEntries.length} new chargebacks to ${sheet.title}`);
        await sheet.addRows(newEntries);
    } else {
        console.log(`🔄 No new chargebacks to add in ${sheet.title}.`);
    }
}

async function updateGoogleSheets() {
    try {
        const doc = await authenticateGoogleSheets();
        for (const store of STORES) {
            console.log(`🔍 Fetching chargebacks for ${store.name}...`);
            const chargebacks = await getChargebacks(store.shopUrl, store.accessToken);
            if (chargebacks.length > 0) {
                const storeSheet = await ensureSheet(doc, store.name);
                await updateChargebacks(storeSheet, chargebacks);
            }
        }
        console.log("✅ Store-specific chargeback data updated successfully!");
    } catch (error) {
        console.error("❌ Error updating Google Sheets:", error.message);
    }
}

app.get("/chargebacks", async (req, res) => {
    await updateGoogleSheets();
    res.json({
        message: "Store-specific chargebacks updated to Google Sheets!"
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
