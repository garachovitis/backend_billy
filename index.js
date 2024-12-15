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
const CHROME_PATH = process.env.CHROME_PATH; // Χρήση της μεταβλητής περιβάλλοντος
// const CHROME_PATH = '/opt/render/.cache/puppeteer/chrome/linux-130.0.6723.116/chrome-linux64/chrome';

app.use((req, res, next) => {
    res.setTimeout(200000); // Θέτει χρονικό όριο 2 λεπτών για όλα τα αιτήματα (120.000 ms)
    next();
});

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

async function saveBillingDataDei(service, username, password, bills) {
    try {
        // Ensure bills is an array, even if a single object is passed
        if (!Array.isArray(bills)) {
            bills = [bills];
        }

        const hashedPassword = await bcrypt.hash(password, 10); // Encrypt the password
        console.log('Saving billing data for DEI...');

        for (const bill of bills) {
            console.log('Processing bill:', bill);

            // Serialize the data
            const dataString = JSON.stringify(bill);

            // Check if the data already exists in the database
            const queryCheck = `SELECT * FROM billing_info WHERE service = ? AND data = ?`;
            db.get(queryCheck, [service, dataString], (err, row) => {
                if (err) {
                    console.error('Error checking data in database:', err.message);
                } else if (row) {
                    console.log(`Entry already exists for service: ${service}, Account: ${bill.accountNumber}, Address: ${bill.address}`);
                } else {
                    // Insert the new data
                    const queryInsert = `INSERT INTO billing_info (service, username, password, data) VALUES (?, ?, ?, ?)`;
                    db.run(queryInsert, [service, username, hashedPassword, dataString], function (err) {
                        if (err) {
                            console.error('Error inserting data into database:', err.message);
                        } else {
                            console.log(`Saved data for ${service} - Account: ${bill.accountNumber}, Address: ${bill.address}`);
                        }
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error saving DEI billing data:', error.message);
    }
}

async function saveBillingDataDeyap(service, username, password, bills) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10); // Κρυπτογράφηση του κωδικού

        for (const bill of bills) {
            console.log('Raw bill data:', bill);

            const dataString = JSON.stringify(bill);

            // Ελέγχουμε αν τα δεδομένα υπάρχουν ήδη στη βάση
            const queryCheck = `SELECT * FROM billing_info WHERE service = ? AND data LIKE ?`;
            db.get(queryCheck, [service, `%${bill.registryNumber || bill.address}%`], (err, row) => {
                if (err) {
                    console.error('Error checking data:', err.message);
                } else if (row) {
                    console.log(`Entry already exists for service: ${service}, registry: ${bill.registryNumber || bill.address}`);
                } else {
                    const queryInsert = `INSERT INTO billing_info (service, username, password, data) VALUES (?, ?, ?, ?)`;
                    db.run(queryInsert, [service, username, hashedPassword, dataString], function (err) {
                        if (err) {
                            console.error('Error inserting data:', err.message);
                        } else {
                            console.log(`Saved data for ${service} - Username: ${username}, Registry/Address: ${bill.registryNumber || bill.address}`);
                        }
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error saving billing data:', error.message);
    }
}
async function saveBillingDataCosmote(service, username, password, bills) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        for (const bill of bills) {
            console.log('Raw bill data:', bill);
            const cleanedBill = cleanCosmoteData(bill); // Καθαρισμός δεδομένων
            const { connection, billNumber, totalAmount, dueDate } = cleanedBill; // Ενημερωμένα δεδομένα

            const queryCheck = `SELECT * FROM billing_info WHERE service = ? AND data LIKE ?`;
            const dataString = JSON.stringify({ connection, billNumber, totalAmount, dueDate });

            db.get(queryCheck, [service, `%${connection}%${billNumber}%`], (err, row) => {
                if (err) {
                    console.error('Error checking data:', err.message);
                } else if (row) {
                    console.log(`Entry already exists for service: ${service}, connection: ${connection}, billNumber: ${billNumber}`);
                } else {
                    const queryInsert = `INSERT INTO billing_info (service, username, password, data) VALUES (?, ?, ?, ?)`;
                    db.run(queryInsert, [service, username, hashedPassword, dataString], function (err) {
                        if (err) {
                            console.error('Error inserting data:', err.message);
                        } else {
                            console.log(`Saved data for ${service} - Username: ${username}, Connection: ${connection}, BillNumber: ${billNumber}`);
                        }
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error hashing password:', error.message);
    }
}

function cleanCosmoteData(bill) {
    const totalAmount = bill.totalAmount
        .replace(/[^\d,.]/g, '')
        .replace(/,+/g, '.')
        .trim();

    let dueDate;
    if (bill.dueDate?.toLowerCase().includes('έχει λήξει')) {
        dueDate = 'Ο λογαριασμός έχει λήξει'; // Ρυθμίζουμε το dueDate για ληγμένους λογαριασμούς
    } else if (bill.dueDate?.includes('αύριο')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dueDate = tomorrow.toLocaleDateString('el-GR'); // Μορφή DD/MM/YYYY
    } else if (bill.dueDate?.match(/\d{2}\/\d{2}/)) {
        const [day, month] = bill.dueDate.split('/');
        dueDate = `${day}/${month}/${new Date().getFullYear()}`;
    } else {
        dueDate = bill.dueDate || 'No due date'; // Διατηρούμε τα υπόλοιπα dueDate ως έχουν
    }

    const cleanedData = {
        connection: bill.connection || 'Unknown connection',
        billNumber: bill.billNumber || 'Unknown bill number',
        totalAmount: parseFloat(totalAmount).toFixed(2) + '€',
        dueDate: dueDate,
    };

    console.log('Cleaned Cosmote data:', cleanedData);
    return cleanedData;
}

function parseDueDate(dueDate) {
    if (dueDate.toLowerCase().includes('αύριο')) {
        // Εάν περιέχει τη λέξη "αύριο", επιστρέφουμε την αυριανή ημερομηνία
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toLocaleDateString('el-GR'); // Μορφή DD/MM/YYYY
    } else if (dueDate.toLowerCase().includes('έχει λήξει')) {
        // Εάν περιέχει τη λέξη "έχει λήξει", επιστρέφουμε "Έχει λήξει"
        return 'Έχει λήξει';
    } else if (dueDate.match(/\d{2}\/\d{2}/)) {
        // Εάν περιέχει ημερομηνία στη μορφή DD/MM, προσθέτουμε το τρέχον έτος
        const [day, month] = dueDate.split('/');
        return `${day}/${month}/${new Date().getFullYear()}`;
    } else {
        // Εάν δεν αναγνωριστεί, επιστρέφουμε την αρχική τιμή
        console.log('Parsing due date (unknown format):', dueDate);
        return dueDate;
    }
}

function getBillingData(callback) {
    const query = `SELECT billingid,service, username, data, categories FROM billing_info`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching data:', err.message);
            callback(err, null);
        } else {
            console.log('Fetched billing data:', rows);
            callback(null, rows);
        }
    });
}

async function scrapeDEI(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--window-size=1920,1080',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'
            ],
        });
        const page = await browser.newPage();
        await page.goto('https://mydei.dei.gr/el/login/', { waitUntil: 'networkidle2' });

        const acceptCookiesButton = await page.$('#onetrust-accept-btn-handler');
        if (acceptCookiesButton) {
            await acceptCookiesButton.click();
            await new Promise(resolve => setTimeout(resolve, 2000));
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
            executablePath: CHROME_PATH,
            protocolTimeout: 1000000, // Αύξηση του timeout σε 15 λεπτά

            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36'
            ]
        });

        const page = await browser.newPage();
        
        // Μετάβαση στη σελίδα σύνδεσης και αποδοχή cookies χωρίς καθυστέρηση
        await page.goto('https://account.cosmote.gr/el/user-login', { waitUntil: 'networkidle2', timeout: 90000 }); // Timeout 90 δευτερόλεπτα
        const acceptCookiesButton = await page.$('#onetrust-accept-btn-handler');
        if (acceptCookiesButton) {
            await acceptCookiesButton.click();
        }

        // Καθυστέρηση για τη φόρτωση πριν την εισαγωγή του ονόματος χρήστη
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 δευτερόλεπτα

        await page.type('#login', username);
        
        // Καθυστέρηση πριν το κλικ για επόμενη ενέργεια
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 δευτερόλεπτα
        
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        // Αναμονή για να εμφανιστεί το πεδίο κωδικού και καθυστέρηση πριν την εισαγωγή του
        await page.waitForSelector('#pwd', { visible: true });
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 δευτερόλεπτα

        await page.type('#pwd', password);

        // Καθυστέρηση πριν την υποβολή
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 δευτερόλεπτα
        
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        // Αναμονή για την ολοκλήρωση της πλοήγησης μετά το login
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 1900000 }); // Timeout 90 δευτερόλεπτα
        
        // Καθυστέρηση πριν την πλοήγηση στον πίνακα ελέγχου
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 δευτερόλεπτα
        
        await page.goto('https://my.cosmote.gr/selfcare/jsp/dashboard.jsp', { waitUntil: 'networkidle2', timeout: 190000 }); // Timeout 90 δευτερόλεπτα

        // Επιπλέον καθυστέρηση για φόρτωση των στοιχείων
        await new Promise(resolve => setTimeout(resolve, 15000)); // 15 δευτερόλεπτα

        // Εξαγωγή δεδομένων λογαριασμού
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
            executablePath: CHROME_PATH, // Χρήση της σωστής διαδρομής
            protocolTimeout: 1000000, // Αύξηση του timeout
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36'
            ]
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
            const statusText = document.querySelector('.state.publish .text')?.innerText.trim() || 'Not found';
            const balance = document.querySelectorAll('td')[7]?.innerText.trim() || 'Not found';

            // Υπολογισμός του dueDate βάσει της κατάστασης
            let dueDate;
            if (statusText.includes('Ενεργός')) {
                dueDate = '31/12/2024'; // Παράδειγμα για ενεργό
            } else if (statusText.includes('Ανενεργός')) {
                dueDate = 'Λογαριασμός ληγμένος'; // Παράδειγμα για ληγμένο
            } else {
                dueDate = 'Καμία ημερομηνία διαθέσιμη'; // Default
            }

            return { registryNumber, consumer, address, position, region, dueDate, balance };
        });

        console.log("ΔΕΥΑΠ Billing Info:", billingInfo);

        await browser.close();
        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during ΔΕΥΑΠ scraping:', error.message);
        return { status: 'error', message: 'ΔΕΥΑΠ scraping failed: ' + error.message };
    }
}


// Νέο endpoint για προσθήκη νέας κατηγορίας
app.post('/api/add-category', (req, res) => {
    const { name, emoji } = req.body;

    if (!name || !emoji) {
        return res.status(400).json({ status: 'error', message: 'Name and emoji are required' });
    }

    const query = `INSERT INTO categories (name, emoji) VALUES (?, ?)`;

    db.run(query, [name, emoji], function (err) {
        if (err) {
            console.error('Error inserting category:', err.message);
            return res.status(500).json({ status: 'error', message: 'Error adding category' });
        }

        return res.json({ 
            status: 'success', 
            message: 'Category added successfully', 
            categoryId: this.lastID // Επιστρέφουμε το ID της νέας κατηγορίας
        });
    });
});

// Ενημέρωση της βάσης δεδομένων για τη δημιουργία του πίνακα κατηγοριών (εάν δεν υπάρχει)
db.run(`CREATE TABLE IF NOT EXISTS categories (
    name TEXT,
    categoryid INTEGER PRIMARY KEY AUTOINCREMENT,
    emoji TEXT
)`);


app.post('/api/save', async (req, res) => {
    const { username, password, service } = req.body;

    if (service === 'dei') {
        const result = await scrapeDEI(username, password);
        if (result.status === 'success') {
            await saveBillingDataDei('dei', username, password, result.data);
        } else {
            console.error('Scraping failed:', result.message);
        }
        
        return res.json(result);
    } else if (service === 'cosmote') {
        const result = await scrapeCosmote(username, password);
        if (result.status === 'success') {
            // Αποθήκευση κάθε λογαριασμού ξεχωριστά
            await saveBillingDataCosmote('cosmote', username, password, result.data);
        }
        return res.json(result);
    } else if (service === 'deyap') {
        const result = await scrapeDeyap(username, password);
        if (result.status === 'success') {
            await saveBillingDataDeyap('deyap', username, password, [result.data]);
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
            console.log('Sending billing info to clienttttt:', data);
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