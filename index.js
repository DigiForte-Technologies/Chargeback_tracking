require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;

// Shopify API Credentials
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Function to get chargebacks (disputes)
async function getChargebacks() {
    try {
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/shopify_payments/disputes.json`;
        
        const response = await axios.get(url, {
            headers: {
                "X-Shopify-Access-Token": ACCESS_TOKEN,
                "Content-Type": "application/json"
            }
        });

        const disputes = response.data.disputes || [];

        return disputes.map(dispute => ({
            orderID: dispute.order_id,
            id: dispute.id,
            status: dispute.status,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
            initiated_at: dispute.initiated_at,
            due_at: dispute.evidence_due_by
        }));

    } catch (error) {
        console.error("Error fetching chargebacks:", error.response?.data || error.message);
        return [];
    }
}

// API Route to Fetch Chargebacks
app.get("/chargebacks", async (req, res) => {
    const chargebacks = await getChargebacks();
    res.json({ chargebacks });
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
