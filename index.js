const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());


const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(cors());

require('dotenv').config();
const PORT = process.env.PORT || 3000;



const db = new sqlite3.Database('./webscrDB.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        // Δημιουργία των πινάκων εάν δεν υπάρχουν
        db.run(`CREATE TABLE IF NOT EXISTS billing_info (
            billingid INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT,
            username TEXT,
            password TEXT,
            categories INTEGER,
            data TEXT
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS categories (
            categoryid INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            emoji TEXT
        )`);
    }
});





app.get('/', (req, res) => {
    res.send("Welcome to the backend server!");
});


async function saveBillingData(service, username, password, newData) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newDueDate = newData.dueDate;
        const newPaymentAmount = newData.paymentAmount;

        const queryCheck = `SELECT * FROM billing_info WHERE service = ? AND data LIKE ?`;
        db.get(queryCheck, [service, `%${newDueDate}%${newPaymentAmount}%`], (err, row) => {
            if (err) {
                console.error('Error checking data:', err.message);
            } else if (row) {
                console.log(`Entry already exists for service: ${service} with dueDate: ${newDueDate} and paymentAmount: ${newPaymentAmount}`);
            } else {
                const queryInsert = `INSERT INTO billing_info (service, username, password, data) VALUES (?, ?, ?, ?)`;
                db.run(queryInsert, [service, username, hashedPassword, JSON.stringify(newData)], function (err) {
                    if (err) {
                        console.error('Error inserting data:', err.message);
                    } else {
                        console.log(`Saved data for ${service} - Username: ${username}`);
                    }
                });
            }
        });
    } catch (error) {
        console.error('Error hashing password:', error.message);
    }
}

function getBillingData(callback) {
    const query = `SELECT billingid,service, username, data, categories FROM billing_info`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching data:', err.message);
            callback(err, null);
        } else {
            callback(null, rows);
        }
    });
}

async function scrapeDEI(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-gpu',
              '--window-size=1920,1080',
              '--disable-blink-features=AutomationControlled',
              '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36'
            ],
          });

        const page = await browser.newPage();
        await page.goto('https://mydei.dei.gr/el/login/', { waitUntil: 'networkidle2' });

        const acceptCookiesButton = await page.$('#onetrust-accept-btn-handler');
        if (acceptCookiesButton) {
            await acceptCookiesButton.click();
            await new Promise(resolve => setTimeout(resolve, 4000));
        }

        await page.type('#loginModel_Username', username);
        await page.type('#loginModel_Password', password);
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        await page.goto('https://mydei.dei.gr/el/', { waitUntil: 'networkidle2' });

        const billingInfo = await page.evaluate(() => {
            const accountNumber = document.querySelector('.e-card-type__txt')?.innerText.trim() || 'Not found';
            const address = document.querySelector('.b-card__title')?.innerText.trim() || 'Not found';
            const dueDate = document.querySelectorAll('.b-bill-sum-tiny__dd')[2]?.innerText.trim() || 'Not found';
            const paymentAmount = document.querySelector('.e-card-total__number')?.innerText.trim() || 'Not found';

            return { accountNumber, address, dueDate, paymentAmount };
        });

        console.log("DEI Billing Info:", billingInfo);
        await browser.close();

        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during DEI scraping:', error.message);
        return { status: 'error', message: 'DEI scraping failed: ' + error.message };
    }
}

async function scrapeCosmote(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-gpu',
              '--window-size=1920,1080',
              '--disable-blink-features=AutomationControlled',
              '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36'
            ],
          });
        const page = await browser.newPage();
        await page.goto('https://account.cosmote.gr/el/user-login', { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 5000));

        await page.type('#login', username);
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        await page.waitForSelector('#pwd', { visible: true });

        await page.type('#pwd', password);
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        await page.goto('https://my.cosmote.gr/selfcare/jsp/dashboard.jsp', { waitUntil: 'networkidle2' });

        await new Promise(resolve => setTimeout(resolve, 9000));

        const billingInfo = await page.evaluate(() => {
            const bills = [];
            const cardSections = document.querySelectorAll('.cardWhite.withMargin.searchFilterBox');

            cardSections.forEach((card) => {
                const connection = card.querySelector('.cardLabelDropdownEntry div')?.innerText.trim() || 'No connection';
                const billNumber = card.querySelector('.cardLabel div')?.innerText.trim() || 'No bill number';
                const amountUnits = card.querySelector('.amountUnits')?.innerText.trim() || '0';
                const amountCents = card.querySelector('.amountCents')?.innerText.trim() || '00';
                const totalAmount = `${amountUnits},${amountCents}€`;
                const dueDate = card.querySelector('.cardText')?.innerText.trim() || 'No due date';

                bills.push({
                    connection,
                    billNumber,
                    totalAmount,
                    dueDate
                });
            });

            return bills;
        });

        console.log("Cosmote Billing Info:", billingInfo);
        await browser.close();
        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during Cosmote scraping:', error.message);
        return { status: 'error', message: 'Cosmote scraping failed: ' + error.message };
    }
}

async function scrapeDeyap(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-gpu',
              '--window-size=1920,1080',
              '--disable-blink-features=AutomationControlled',
              '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36'
            ],
          });
        const page = await browser.newPage();

        await page.goto('https://deyaponline.gr/login', { waitUntil: 'networkidle2' });

        await page.type('#username', username);
        await page.type('#password', password);

        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        await page.goto('https://deyaponline.gr/water-account-user-login-redirect/accountinfo', { waitUntil: 'networkidle2' });

        const billingInfo = await page.evaluate(() => {
            const registryNumber = document.querySelector('td[rowspan="2"]')?.innerText.trim() || 'Not found';
            const consumer = document.querySelectorAll('td')[1]?.innerText.trim() || 'Not found';
            const address = document.querySelectorAll('td')[2]?.innerText.trim() || 'Not found';
            const position = document.querySelectorAll('td')[3]?.innerText.trim() || 'Not found';
            const region = document.querySelectorAll('td')[4]?.innerText.trim() || 'Not found';
            const status = document.querySelector('.state.publish .text')?.innerText.trim() || 'Not found';
            const balance = document.querySelectorAll('td')[7]?.innerText.trim() || 'Not found';

            return { registryNumber, consumer, address, position, region, status, balance };
        });

        console.log("ΔΕΥΑΠ Billing Info:", billingInfo);

        await browser.close();
        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during ΔΕΥΑΠ scraping:', error.message);
        return { status: 'error', message: 'ΔΕΥΑΠ scraping failed: ' + error.message };
    }
}





app.post('/api/save', async (req, res) => {
    const { username, password, service } = req.body;

    if (service === 'dei') {
        const result = await scrapeDEI(username, password);
        if (result.status === 'success') {
            await saveBillingData('dei', username, password, result.data);
        }
        return res.json(result);
    } else if (service === 'cosmote') {
        const result = await scrapeCosmote(username, password);
        if (result.status === 'success') {
            await saveBillingData('cosmote', username, password, result.data);
        }
        return res.json(result);
    } else if (service === 'deyap') {
        const result = await scrapeDeyap(username, password);
        if (result.status === 'success') {
            await saveBillingData('deyap', username, password, result.data);
        }
        return res.json(result);
    } else {
        return res.status(400).json({ status: 'error', message: 'Invalid service' });
    }
});

app.get('/billing-info', (req, res) => {
    getBillingData((err, data) => {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Error fetching data' });
        } else {
            return res.json({ status: 'success', data });
        }
    });
});

// Endpoint για να φέρνει τις κατηγορίες από τη βάση δεδομένων
app.get('/categories', (req, res) => {
    const query = `SELECT categoryid, name, emoji FROM categories`;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching categories:', err.message);
            return res.status(500).json({ status: 'error', message: 'Error fetching categories' });
        }

        if (rows.length > 0) {
            return res.json({ status: 'success', data: rows });
        } else {
            return res.json({ status: 'error', message: 'No categories found' });
        }
    });
});


app.post('/update-billing-category', (req, res) => {
    const { billingid, categoryid } = req.body;

    // console.log('Received billingId:', billingid);
    // console.log('Received categoryId:', categoryid);

    if (!billingid || !categoryid) {
        return res.status(400).json({ status: 'error', message: 'Missing billingId or categoryId' });
    }

    const query = `UPDATE billing_info SET categories = ? WHERE billingid = ?`; // Updated to match the correct column name

    db.run(query, [categoryid, billingid], function(err) {
        if (err) {
            // console.error('Error updating category:', err.message);
            return res.status(500).json({ status: 'error', message: 'Error updating category' });
        }

        // console.log('Number of rows updated:', this.changes);

        if (this.changes > 0) {
            return res.json({ status: 'success', message: 'Category updated successfully' });
        } else {
            return res.status(404).json({ status: 'error', message: 'Billing not found' });
        }
    });
});


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });