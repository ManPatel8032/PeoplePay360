import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query, one } from '../src/db.js';

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Kabir', 'Ananya', 'Diya', 'Gauri', 'Isha',
  'Kavya', 'Khushi', 'Mira', 'Navya', 'Pooja', 'Priya', 'Riya', 'Saanvi', 'Shreya', 'Sneha',
  'Tanvi', 'Veda', 'Zoya', 'Tara', 'Rohan', 'Vikram', 'Meera', 'Devansh', 'Sana', 'Farhan',
  'Ishita', 'Karan', 'Kunal', 'Neha', 'Nisha', 'Rohini', 'Aditi', 'Alok', 'Amit', 'Anil',
  'Anjali', 'Ankita', 'Ansh', 'Archana', 'Ashok', 'Bhavna', 'Chetan', 'Deepa', 'Deepak', 'Divya',
  'Gautam', 'Geeta', 'Harish', 'Hemant', 'Indira', 'Jatin', 'Jaya', 'Kailash', 'Kamal', 'Kiran',
  'Lalit', 'Madhav', 'Manish', 'Megha', 'Mohan', 'Mukesh', 'Nandini', 'Naveen', 'Nidhi', 'Nikhil',
  'Nilesh', 'Pallavi', 'Pankaj', 'Parul', 'Pawan', 'Pradeep', 'Prakash', 'Prateek', 'Preeti', 'Rahul',
  'Rajesh', 'Rakesh', 'Ramesh', 'Rashmi', 'Ravi', 'Rekha', 'Rishi', 'Ritu', 'Sachin', 'Sameer',
  'Sandhya', 'Sanjay', 'Santosh', 'Sarita', 'Satish', 'Seema', 'Shailesh', 'Shalini', 'Shankar', 'Shikha',
  'Shivam', 'Shobha', 'Shruti', 'Siddharth', 'Simran', 'Smita', 'Snehal', 'Sonal', 'Sourabh', 'Subhash',
  'Sudhir', 'Sujata', 'Suman', 'Sunil', 'Sunita', 'Suresh', 'Surya', 'Swati', 'Tarun', 'Umesh',
  'Varun', 'Vikas', 'Vinay', 'Vinod', 'Vipul', 'Vishal', 'Yash', 'Yogesh', 'Abhay', 'Abhishek'
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Mehta', 'Nair', 'Iyer', 'Joshi', 'Kulkarni', 'Rao', 'Deshpande',
  'Gupta', 'Singh', 'Malhotra', 'Bhatia', 'Banerjee', 'Shah', 'Qureshi', 'Naik', 'Pillai', 'Sheikh',
  'Kapoor', 'Menon', 'Chopra', 'Agarwal', 'Reddy', 'Choudhury', 'Bose', 'Das', 'Dutta', 'Ghosh',
  'Mukherjee', 'Chatterjee', 'Roy', 'Sen', 'Sengupta', 'Mishra', 'Pandey', 'Trivedi', 'Shukla', 'Dubey',
  'Tripathi', 'Tiwari', 'Bhatt', 'Rawat', 'Negi', 'Bisht', 'Chauhan', 'Rathore', 'Solanki', 'Parmar',
  'Jadhav', 'Pawar', 'More', 'Shinde', 'Gaikwad', 'Kadam', 'Sawant', 'Bhosale', 'Patil', 'Deshmukh',
  'Bhende', 'Wagh', 'Tambe', 'Gore', 'Kale', 'Gokhale', 'Apte', 'Bapat', 'Pendse', 'Kirloskar',
  'Bhandari', 'Salian', 'Shetty', 'Pujari', 'Kotian', 'Suvarna', 'Bangera', 'Amin', 'Karkera', 'Devadiga'
];

const BANKS = ['HDFC0001', 'ICIC0002', 'SBIN0003', 'AXIS0004', 'KOTK0005', 'PUNB0006', 'BARB0007'];

function rnd(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rndInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function run() {
  console.log('Connecting to database...');
  
  // Load metadata
  const depts = await query('SELECT id, name FROM departments');
  const deptMap = Object.fromEntries(depts.map((d) => [d.name, d.id]));

  const hrDeptId = deptMap['Human Resources'] || depts[0].id;
  const finDeptId = deptMap['Finance'] || depts[0].id;
  const engDeptId = deptMap['Engineering'] || depts[0].id;
  const salesDeptId = deptMap['Sales'] || depts[0].id;
  const opsDeptId = deptMap['Operations'] || depts[0].id;

  const positions = await query('SELECT id, name, department_id FROM job_positions');
  const posByDept = {};
  for (const p of positions) {
    if (!posByDept[p.department_id]) posByDept[p.department_id] = [];
    posByDept[p.department_id].push(p.id);
  }

  const schedules = await query('SELECT id, name FROM working_schedules');
  const schedIds = schedules.map((s) => s.id);

  const structures = await query('SELECT id, name FROM salary_structures');
  const regStruct = structures.find((s) => s.name.toLowerCase().includes('regular'))?.id || structures[0]?.id;
  const contStruct = structures.find((s) => s.name.toLowerCase().includes('contract'))?.id || structures[0]?.id;

  const existingEmployees = await query('SELECT id, name FROM employees WHERE status = $1', ['active']);
  const managerPool = existingEmployees.map((e) => e.id);

  const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
  console.log('Hashing default password for new users...');
  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, 10);

  // Role distribution for 250 records:
  // - employee: 175
  // - hr_manager: 35
  // - payroll_user: 25
  // - payroll_manager: 15
  const roles = [
    ...Array(175).fill('employee'),
    ...Array(35).fill('hr_manager'),
    ...Array(25).fill('payroll_user'),
    ...Array(15).fill('payroll_manager'),
  ];

  // Shuffle roles
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  console.log(`Starting insertion of ${roles.length} records...`);

  const inserted = {
    employee: 0,
    hr_manager: 0,
    payroll_user: 0,
    payroll_manager: 0,
  };

  const stamp = Date.now().toString().slice(-4);

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const fName = rnd(FIRST_NAMES);
    const lName = rnd(LAST_NAMES);
    const fullName = `${fName} ${lName}`;
    const seq = i + 1;
    const cleanEmailBase = `${fName.toLowerCase()}.${lName.toLowerCase()}.${stamp}${seq}`;
    const workEmail = `${cleanEmailBase}@peoplepay360.com`;
    const phone = `+91 9${rndInt(100000000, 999999999)}`;
    const bankAccount = `${rnd(BANKS)}-${rndInt(1000000, 9999999)}`;

    // Pick department and job position based on role
    let deptId;
    if (role === 'hr_manager') {
      deptId = hrDeptId;
    } else if (role === 'payroll_manager' || role === 'payroll_user') {
      deptId = finDeptId;
    } else {
      deptId = rnd([engDeptId, salesDeptId, opsDeptId, hrDeptId, finDeptId]);
    }

    const availablePos = posByDept[deptId] || positions.map((p) => p.id);
    const jobPosId = rnd(availablePos);
    const schedId = rnd(schedIds);
    const managerId = managerPool.length > 0 ? rnd(managerPool) : null;

    const empType = role === 'employee' ? rnd(['full_time', 'full_time', 'full_time', 'contract', 'intern']) : 'full_time';
    const status = Math.random() < 0.92 ? 'active' : Math.random() < 0.5 ? 'on_leave' : 'inactive';

    const joinYear = rndInt(2023, 2025);
    const joinMonth = String(rndInt(1, 12)).padStart(2, '0');
    const joinDay = String(rndInt(1, 28)).padStart(2, '0');
    const joinDate = `${joinYear}-${joinMonth}-${joinDay}`;

    // 1. Insert Employee
    const emp = await one(
      `INSERT INTO employees (name, work_email, phone, department_id, job_position_id, manager_id,
                              schedule_id, employee_type, status, bank_account, join_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [fullName, workEmail, phone, deptId, jobPosId, managerId, schedId, empType, status, bankAccount, joinDate]
    );

    const empId = emp.id;
    managerPool.push(empId); // Can now also manage future subordinates

    // 2. Insert Contract
    const structureId = empType === 'contract' ? contStruct : regStruct;
    let wage;
    if (role === 'payroll_manager' || role === 'hr_manager') {
      wage = rndInt(110000, 185000);
    } else if (role === 'payroll_user') {
      wage = rndInt(65000, 105000);
    } else if (empType === 'intern') {
      wage = rndInt(25000, 35000);
    } else if (empType === 'contract') {
      wage = rndInt(50000, 95000);
    } else {
      wage = rndInt(45000, 130000);
    }

    await query(
      `INSERT INTO contracts (employee_id, name, start_date, end_date, department_id, job_position_id,
                              schedule_id, wage, structure_id, state)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, 'running')`,
      [empId, `${fullName} — Employment Contract`, joinDate, deptId, jobPosId, schedId, wage, structureId]
    );

    // 3. Insert User
    await query(
      `INSERT INTO users (name, email, password_hash, role, employee_id, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE)`,
      [fullName, workEmail, passwordHash, role, empId]
    );

    inserted[role]++;
  }

  const totals = await one(`
    SELECT (SELECT COUNT(*)::int FROM employees) AS total_employees,
           (SELECT COUNT(*)::int FROM users) AS total_users,
           (SELECT COUNT(*)::int FROM contracts) AS total_contracts
  `);

  console.log('✅ Successfully inserted 250 dummy records!');
  console.log('Breakdown by role:', inserted);
  console.log('New database totals:', totals);

  await pool.end();
}

run().catch((err) => {
  console.error('Error inserting dummy records:', err);
  process.exit(1);
});
