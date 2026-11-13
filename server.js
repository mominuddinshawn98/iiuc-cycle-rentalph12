require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const HOURLY_RATE = 20; // Rental fee in BDT per hour

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "campus_cycle",
    waitForConnections: true,
    connectionLimit: 10
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || "please_change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax"
    }
}));

app.use(express.static(path.join(__dirname, "public")));

function studentOnly(req, res, next) {
    if (req.session.studentId) {
        return next();
    }
    return res.status(401).json({ message: "Please log in as a student." });
}

function adminOnly(req, res, next) {
    if (req.session.adminId) {
        return next();
    }
    return res.status(401).json({ message: "Please log in as admin." });
}

// Create the one fixed admin account if it does not already exist.
async function createDefaultAdmin() {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";

    const [rows] = await db.execute(
        "SELECT id FROM admins WHERE username = ?",
        [username]
    );

    if (rows.length === 0) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.execute(
            "INSERT INTO admins (username, password) VALUES (?, ?)",
            [username, hashedPassword]
        );
        console.log("Default admin account created.");
    }
}

// Student registration
app.post("/api/register", async (req, res) => {
    try {
        const { name, student_id, email, password } = req.body;

        if (!name || !student_id || !email || !password) {
            return res.status(400).json({ message: "Please fill in all fields." });
        }

        if (name.trim().length > 100 || student_id.trim().length > 50 || email.trim().length > 120) {
            return res.status(400).json({ message: "One or more fields are too long." });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.execute(
            "INSERT INTO students (name, student_id, email, password) VALUES (?, ?, ?, ?)",
            [name.trim(), student_id.trim(), email.trim().toLowerCase(), hashedPassword]
        );

        res.json({ message: "Registration successful. You can now log in." });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Student ID or email already exists." });
        }
        console.error(error);
        res.status(500).json({ message: "Registration failed. Please try again." });
    }
});

// Student login
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const [students] = await db.execute(
            "SELECT * FROM students WHERE email = ?",
            [email]
        );

        if (students.length === 0) {
            return res.status(401).json({ message: "Incorrect email or password." });
        }

        const student = students[0];
        const passwordMatches = await bcrypt.compare(password, student.password);

        if (!passwordMatches) {
            return res.status(401).json({ message: "Incorrect email or password." });
        }

        // Start a fresh session after successful login.
        await new Promise((resolve, reject) => {
            req.session.regenerate((error) => error ? reject(error) : resolve());
        });

        req.session.studentId = student.id;
        req.session.studentName = student.name;
        req.session.adminId = null;

        res.json({ message: "Login successful." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Login failed." });
    }
});

// Fixed admin login
app.post("/api/admin/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const [admins] = await db.execute(
            "SELECT * FROM admins WHERE username = ?",
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({ message: "Incorrect admin username or password." });
        }

        const admin = admins[0];
        const passwordMatches = await bcrypt.compare(password, admin.password);

        if (!passwordMatches) {
            return res.status(401).json({ message: "Incorrect admin username or password." });
        }

        // Start a fresh session after successful login.
        await new Promise((resolve, reject) => {
            req.session.regenerate((error) => error ? reject(error) : resolve());
        });

        req.session.adminId = admin.id;
        req.session.studentId = null;
        req.session.studentName = null;

        res.json({ message: "Admin login successful." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Admin login failed." });
    }
});

// Current logged-in student
app.get("/api/student/me", studentOnly, async (req, res) => {
    const [rows] = await db.execute(
        "SELECT id, name, student_id, email FROM students WHERE id = ?",
        [req.session.studentId]
    );
    res.json(rows[0]);
});

// List bicycles
app.get("/api/bicycles", async (req, res) => {
    try {
        const [rows] = await db.execute(
            "SELECT id, bicycle_code, bicycle_name, status FROM bicycles ORDER BY id DESC"
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load bicycles." });
    }
});

// Student picks up a bicycle. A transaction and row lock prevent double-renting.
app.post("/api/rent", studentOnly, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const bicycleCode = (req.body.bicycle_code || "").trim();

        if (!bicycleCode) {
            return res.status(400).json({ message: "Enter a bicycle code." });
        }

        await connection.beginTransaction();

        // Lock this student's row so two requests cannot rent two bicycles at once.
        await connection.execute(
            "SELECT id FROM students WHERE id = ? FOR UPDATE",
            [req.session.studentId]
        );

        const [activeRentals] = await connection.execute(
            "SELECT id FROM rentals WHERE student_id = ? AND return_time IS NULL",
            [req.session.studentId]
        );

        if (activeRentals.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: "Return your current bicycle before renting another." });
        }

        const [bicycles] = await connection.execute(
            "SELECT * FROM bicycles WHERE bicycle_code = ? FOR UPDATE",
            [bicycleCode]
        );

        if (bicycles.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Bicycle code not found." });
        }

        const bicycle = bicycles[0];

        if (bicycle.status !== "Available") {
            await connection.rollback();
            return res.status(400).json({ message: "This bicycle is already rented." });
        }

        await connection.execute(
            "INSERT INTO rentals (student_id, bicycle_id, pickup_time) VALUES (?, ?, NOW())",
            [req.session.studentId, bicycle.id]
        );

        await connection.execute(
            "UPDATE bicycles SET status = 'Rented' WHERE id = ?",
            [bicycle.id]
        );

        await connection.commit();
        res.json({ message: "Bicycle pickup confirmed successfully." });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "Could not rent the bicycle." });
    } finally {
        connection.release();
    }
});

// Student returns their currently rented bicycle.
app.post("/api/return", studentOnly, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const bicycleCode = (req.body.bicycle_code || "").trim();

        if (!bicycleCode) {
            return res.status(400).json({ message: "Enter the bicycle code." });
        }

        await connection.beginTransaction();

        const [rentals] = await connection.execute(
            `SELECT rentals.id, rentals.bicycle_id, rentals.pickup_time
             FROM rentals
             JOIN bicycles ON rentals.bicycle_id = bicycles.id
             WHERE rentals.student_id = ?
             AND bicycles.bicycle_code = ?
             AND rentals.return_time IS NULL
             FOR UPDATE`,
            [req.session.studentId, bicycleCode]
        );

        if (rentals.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "No active rental found for this bicycle code." });
        }

        const rental = rentals[0];

        const [timeRows] = await connection.execute(
            "SELECT TIMESTAMPDIFF(MINUTE, pickup_time, NOW()) AS minutes FROM rentals WHERE id = ?",
            [rental.id]
        );

        const minutes = Math.max(1, Number(timeRows[0].minutes));
        const hours = Math.max(1, Math.ceil(minutes / 60));
        const fee = hours * HOURLY_RATE;

        await connection.execute(
            `UPDATE rentals
             SET return_time = NOW(), duration_minutes = ?, total_fee = ?
             WHERE id = ?`,
            [minutes, fee, rental.id]
        );

        await connection.execute(
            "UPDATE bicycles SET status = 'Available' WHERE id = ?",
            [rental.bicycle_id]
        );

        await connection.commit();

        res.json({
            message: "Bicycle returned successfully.",
            duration_minutes: minutes,
            billed_hours: hours,
            total_fee: fee
        });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "Could not return the bicycle." });
    } finally {
        connection.release();
    }
});

// Student rental history
app.get("/api/student/history", studentOnly, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT rentals.id, bicycles.bicycle_code, bicycles.bicycle_name,
                    rentals.pickup_time, rentals.return_time,
                    rentals.duration_minutes, rentals.total_fee,
                    rentals.payment_status
             FROM rentals
             JOIN bicycles ON rentals.bicycle_id = bicycles.id
             WHERE rentals.student_id = ?
             ORDER BY rentals.id DESC`,
            [req.session.studentId]
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load rental history." });
    }
});

// Admin adds a bicycle
app.post("/api/admin/bicycles", adminOnly, async (req, res) => {
    try {
        const { bicycle_code, bicycle_name } = req.body;

        if (!bicycle_code || !bicycle_name) {
            return res.status(400).json({ message: "Enter bicycle code and name." });
        }

        await db.execute(
            "INSERT INTO bicycles (bicycle_code, bicycle_name) VALUES (?, ?)",
            [bicycle_code.trim(), bicycle_name.trim()]
        );

        res.json({ message: "Bicycle added successfully." });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "This bicycle code already exists." });
        }
        console.error(error);
        res.status(500).json({ message: "Could not add bicycle." });
    }
});

// Admin edits a bicycle
app.put("/api/admin/bicycles/:id", adminOnly, async (req, res) => {
    try {
        const { bicycle_code, bicycle_name } = req.body;

        if (!bicycle_code || !bicycle_name) {
            return res.status(400).json({ message: "Enter bicycle code and name." });
        }

        const [result] = await db.execute(
            `UPDATE bicycles SET bicycle_code = ?, bicycle_name = ?
             WHERE id = ? AND status = 'Available'`,
            [bicycle_code.trim(), bicycle_name.trim(), req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ message: "Bicycle not found or currently rented." });
        }

        res.json({ message: "Bicycle updated successfully." });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "This bicycle code already exists." });
        }
        console.error(error);
        res.status(500).json({ message: "Could not update bicycle." });
    }
});

// Admin deletes only an available bicycle that has no rental history.
app.delete("/api/admin/bicycles/:id", adminOnly, async (req, res) => {
    try {
        const [result] = await db.execute(
            `DELETE FROM bicycles
             WHERE id = ?
             AND status = 'Available'
             AND id NOT IN (SELECT bicycle_id FROM rentals)`,
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ message: "This bicycle cannot be deleted because it is rented or has rental history." });
        }

        res.json({ message: "Bicycle deleted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not delete bicycle." });
    }
});

// Admin dashboard statistics
app.get("/api/admin/stats", adminOnly, async (req, res) => {
    try {
        const [totalRows] = await db.execute("SELECT COUNT(*) AS total FROM rentals");
        const [activeRows] = await db.execute("SELECT COUNT(*) AS total FROM rentals WHERE return_time IS NULL");
        const [unpaidRows] = await db.execute(
            "SELECT COALESCE(SUM(total_fee), 0) AS total FROM rentals WHERE payment_status = 'Unpaid' AND return_time IS NOT NULL"
        );

        res.json({
            total_rentals: totalRows[0].total,
            active_rentals: activeRows[0].total,
            unpaid_fees: unpaidRows[0].total
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load dashboard statistics." });
    }
});

// Admin views all rental records with optional search and date filters.
app.get("/api/admin/rentals", adminOnly, async (req, res) => {
    try {
        let sql = `
            SELECT rentals.id, students.name AS student_name,
                   students.student_id AS student_code,
                   bicycles.bicycle_code, bicycles.bicycle_name,
                   rentals.pickup_time, rentals.return_time,
                   rentals.duration_minutes, rentals.total_fee,
                   rentals.payment_status
            FROM rentals
            JOIN students ON rentals.student_id = students.id
            JOIN bicycles ON rentals.bicycle_id = bicycles.id
            WHERE 1 = 1`;
        const values = [];

        if (req.query.search) {
            sql += ` AND (students.name LIKE ? OR students.student_id LIKE ? OR bicycles.bicycle_code LIKE ?)`;
            const search = "%" + req.query.search + "%";
            values.push(search, search, search);
        }

        if (req.query.date) {
            sql += " AND DATE(rentals.pickup_time) = ?";
            values.push(req.query.date);
        }

        sql += " ORDER BY rentals.id DESC";

        const [rows] = await db.execute(sql, values);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load rental records." });
    }
});

// Admin marks a completed rental as paid or unpaid.
app.put("/api/admin/rentals/:id/payment", adminOnly, async (req, res) => {
    try {
        const { payment_status } = req.body;

        if (!["Paid", "Unpaid"].includes(payment_status)) {
            return res.status(400).json({ message: "Invalid payment status." });
        }

        const [result] = await db.execute(
            `UPDATE rentals SET payment_status = ?
             WHERE id = ? AND return_time IS NOT NULL`,
            [payment_status, req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ message: "Rental not found or bicycle has not been returned." });
        }

        res.json({ message: "Payment status updated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not update payment status." });
    }
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ message: "Logged out successfully." });
    });
});

async function startServer() {
    try {
        await db.query("SELECT 1");
        await createDefaultAdmin();

        app.listen(PORT, () => {
            console.log(`Campus Cycle Rental System is running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Could not connect to MySQL. Check your .env settings and database setup.");
        console.error(error.message);
        process.exit(1);
    }
}

startServer();