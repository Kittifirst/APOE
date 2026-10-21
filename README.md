# A Place on earth · Halloween Café

เว็บเกมสำหรับคาเฟ่: วงล้อ จับคู่รูปภาพ ตู้คีบ และเกมตอบคำถาม พร้อมธีม Halloween โทนฟักทอง ม่วงเข้ม และครีม ใช้ GitHub Pages สำหรับหน้าเว็บ และ Google Sheets ผ่าน Google Apps Script สำหรับข้อมูลกลาง

## หาไฟล์ที่ต้องการแก้

```text
index.html                 หน้าเว็บหลัก
README.md                  คู่มือไฟล์นี้
START-WEB-APP.cmd           ดับเบิลคลิกเพื่อเปิดเซิร์ฟเวอร์
package.json               คำสั่งเปิดเว็บ ทดสอบ และ build
package-lock.json          เวอร์ชัน dependencies
games/
  wheel/                   กฎวงล้อ สต็อก เอฟเฟกต์ และธีมวงล้อ
  memory/                  เกมจับคู่รูปภาพ
  claw/                    เกมตู้คีบ
  quiz/                    เกมตอบคำถาม
app/
  app-config.js            ใส่ URL ของ Google Apps Script ที่นี่
  bootstrap.js             โหลดข้อมูลและเริ่มเว็บ
  main.js                  ควบคุมหน้าจอ เมนู ผู้ดูแล และหน้าวงล้อ
  motion.js                การเคลื่อนไหวของเมนูและหน้าเว็บ
  storage/                 ตัวเชื่อมข้อมูลกลาง
styles/                    หน้าตาร่วมกันของทุกเกม
backend/
  server.cjs               เซิร์ฟเวอร์สำหรับเปิดในร้าน
  central-store.cjs         ตัวอ่าน/เขียนไฟล์ข้อมูลเดิม
  google-apps-script/      โค้ดที่นำไปวางใน Google Apps Script
scripts/                   สร้างชุดไฟล์สำหรับ deploy และ Apps Script
tests/                     ชุดทดสอบทั้งหมด
data/                      ข้อมูลร้านและสำเนาสำรอง
dist/                      เว็บที่สร้างแล้ว พร้อม deploy (สร้างอัตโนมัติ)
archive/                   ตัวอย่างเก่า รายงาน และไฟล์ทดลองที่เก็บไว้
```

**แก้วงล้อ:** ไปที่ `games/wheel/` — `wheel-engine.js` คือกฎสุ่ม, `wheel-state.js` คือสต็อก/ประวัติ, `wheel-effects.js` คือเอฟเฟกต์ และ `wheel.css` คือฉาก Halloween ส่วนหน้าวงล้อและการนำทางร่วมอยู่ใน `app/main.js`

**เชื่อม Google Sheets:** แก้ไฟล์ `app/app-config.js` แล้วทำตามขั้นตอนด้านล่าง

โฟลเดอร์ `archive/` เก็บไฟล์เก่าไว้สำหรับอ้างอิง และไม่รวมอยู่ในเว็บที่ deploy ส่วน `node_modules/` และ `dist/` เป็นไฟล์ที่ระบบสร้างให้ ไม่ต้องแก้เอง

## ทดลองตอนนี้

รัน `npm start` แล้วเปิด `http://localhost:4173` หรือดับเบิลคลิก `START-WEB-APP.cmd`

เมื่อ `googleSheetsUrl` ใน `app/app-config.js` ยังว่าง เว็บจะแสดง **โหมดทดลอง** และบันทึกข้อมูลในเบราว์เซอร์ของเครื่องนั้น ผู้ดูแลโหมดทดลองใช้ `admin` / `1234` ข้อมูลทดลองไม่ซิงก์ข้ามเครื่อง และไม่ถูกย้ายเข้า Sheets อัตโนมัติ

ไฟล์ข้อมูลเดิม `data/all-jao-games.json` และสำเนา `.bak` ยังคงอยู่ เซิร์ฟเวอร์ไฟล์เดิมและ `/api/state/...` ยังใช้ได้สำหรับการติดตั้งเก่า หน้าเว็บใหม่จะใช้โหมดที่กำหนดใน `app/app-config.js`

## เชื่อม Google Sheets ภายหลัง

1. สร้าง Google Sheet ใหม่ แล้วเปิด **Extensions → Apps Script**
2. วางโค้ดจาก `backend/google-apps-script/Code.gs` ในไฟล์ `Code.gs` และสร้างไฟล์อีกอันชื่อ `GameModels.gs` โดยคัดลอกจากไฟล์ชื่อเดียวกันในโปรเจกต์นี้ ต้องมีครบทั้งสองไฟล์
3. ใน **Project Settings → Script properties** เพิ่ม `ADMIN_PASSWORD` เป็นรหัสผ่านผู้ดูแลที่คุณเลือก และเพิ่ม `ADMIN_USERNAME` หากไม่ต้องการใช้ชื่อ `admin` เก็บรหัสผ่านใน Script properties เท่านั้น
4. คลิกไฟล์ `Code.gs` ทางซ้ายใน Apps Script แล้วกด **Ctrl+S** เพื่อบันทึก มองที่แถบเครื่องมือด้านบน ใกล้ปุ่ม **Run / เรียกใช้** และ **Debug** จะมีช่องเลือกชื่อฟังก์ชัน ให้เลือก `setup` จากช่องนั้น แล้วกด **Run** และอนุญาตสิทธิ์ ระบบจะสร้างแท็บ `jao_wheel`, `jao_claw`, `jao_memory`, `jao_quiz` การรัน `setup` ซ้ำจะรักษาข้อมูลที่มีอยู่ หากไม่มี `setup` ให้ตรวจว่าวางโค้ดจาก `backend/google-apps-script/Code.gs` ครบทั้งไฟล์ โดยแทนที่โค้ดตัวอย่าง `myFunction` เดิม และมีบรรทัด `function setup() {` อยู่ด้านบนของไฟล์ อย่าวางโค้ดซ้อนอยู่ภายใน `myFunction`
5. เลือก **Deploy → New deployment → Web app**, ตั้ง **Execute as: Me** และ **Who has access: Anyone** แล้ว Deploy หน้าเว็บต้องเรียก API ได้โดยไม่ต้องให้ลูกค้าเข้าสู่บัญชี Google หากบัญชีองค์กรไม่มีตัวเลือก Anyone ให้ใช้บัญชีที่อนุญาตการเผยแพร่ Web App
6. คัดลอก URL ของ Web App ที่ลงท้าย `/exec` ใส่ใน `app/app-config.js`:

```js
window.JAO_CONFIG = Object.freeze({
    googleSheetsUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
    pollIntervalMs: 30000
});
```

7. อัปโหลดเว็บใหม่ แล้วตรวจว่ามุมล่างแสดง **เชื่อมต่อข้อมูลร้านแล้ว** ทดลองเข้าสู่ระบบผู้ดูแล บันทึกการตั้งค่า เปิดจากอีกเครื่อง และลองสุ่มรางวัลหนึ่งรอบก่อนใช้จริง

URL ของ Sheet ใช้แทน URL ของ Apps Script ไม่ได้ ไม่ต้องเปิด Sheet เป็นสาธารณะ และไม่ต้องสร้าง service-account key เมื่อแก้โค้ด Apps Script ให้ไป **Deploy → Manage deployments → Edit → New version** เพื่ออัปเดต deployment เดิม

ข้อมูลแต่ละเกมเก็บเป็น JSON ที่เข้ารหัส Base64 และแบ่งหลายเซลล์ เพื่อรองรับภาพการ์ดที่ใหญ่กว่าหนึ่งเซลล์ ให้แก้ข้อมูลผ่านหน้าผู้ดูแลเว็บ การแก้เซลล์ภายในเองอาจทำให้ข้อมูลอ่านไม่ได้ มีสำเนาสองชุดต่อเกมเพื่อคงข้อมูลชุดก่อนหน้าระหว่างบันทึก

วงล้อและตู้คีบสุ่มและตัดสต็อกใน Apps Script ภายใต้ `LockService` การส่งรหัสการสุ่มเดิมซ้ำจะคืนผลเดิม หน้าผู้ดูแลใช้ session อายุประมาณหนึ่งชั่วโมง และตรวจ version ก่อนเขียนเพื่อป้องกันข้อมูลจากสองเครื่องทับกัน หากบันทึกออนไลน์ไม่สำเร็จ เว็บจะแจ้งให้ลองใหม่และไม่แสดงว่าบันทึกในเครื่องสำเร็จแทน

เว็บออกแบบสำหรับกิจกรรมในคาเฟ่ ไม่ได้จำกัดจำนวนสิทธิ์ต่อคน ผู้ที่เข้าถึง URL สามารถเล่นซ้ำได้ และคะแนน Quiz มาจากฝั่งเบราว์เซอร์ หากใช้กับรางวัลจริง พนักงานควรควบคุมสิทธิ์และตรวจผลก่อนแลกรางวัล Apps Script มีโควตาตามบัญชี Google; ควรทดลองจำนวนเครื่องที่ร้านจะใช้จริง

## ย้ายข้อมูลเดิมจากไฟล์เซิร์ฟเวอร์

ทำหลังตั้งค่า Sheet แต่ก่อนเปิดให้ลูกค้าใช้งาน:

1. สำรอง `data/all-jao-games.json` แล้วอัปโหลดไฟล์นี้เข้า Google Drive ของเจ้าของ Apps Script โดยเก็บเป็นไฟล์ส่วนตัว
2. เพิ่ม Script property `IMPORT_FILE_ID` เป็นรหัสไฟล์ Google Drive ที่อัปโหลด
3. รัน `importLegacyData` ใน Apps Script ระบบจะตรวจข้อมูลและย้ายเฉพาะลงฐานข้อมูลใหม่ที่ยังไม่มีการใช้งาน จากนั้นนำ `IMPORT_FILE_ID` ออก

ข้อมูลใน localStorage ของโหมดทดลองไม่รวมอยู่ในไฟล์เซิร์ฟเวอร์ ให้ตั้งค่าจริงใน Sheets ก่อนเริ่มงาน หรือส่งออกประวัติ CSV เพื่อเก็บสำเนา

## Deploy บน GitHub Pages

1. Push โปรเจกต์ขึ้น repository ของคุณ โดยให้ `app/app-config.js` มี URL จริงเมื่อพร้อม
2. ที่ repository เปิด **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. Workflow `.github/workflows/pages.yml` จะทดสอบและสร้างเว็บเมื่อ push เข้า `main` หรือ `master` หรือสั่ง **Run workflow** เองได้
4. เปิด URL จาก deployment ที่สำเร็จ หน้าเว็บใช้ path แบบ relative จึงรองรับ `https://USERNAME.github.io/REPOSITORY/`

`npm run build` สร้างเฉพาะไฟล์หน้าเว็บที่อนุญาตใน `dist/` โดยไม่รวมฐานข้อมูล `.bak`, โค้ดเซิร์ฟเวอร์, Apps Script และรายงานทดสอบ หลีกเลี่ยงการเพิ่ม `data/` หรือรหัสผ่านลง Git ถ้าข้อมูลเคยถูก commit แล้ว ต้องนำออกจาก repository/history ก่อนตั้ง repository เป็นสาธารณะ

## ตรวจโค้ด

```text
npm ci
npm test
npm run build:apps-script
npm run build
```

`GameModels.gs` สร้างจากกฎเกมเดียวกับหน้าเว็บ เมื่อแก้กฎหรือค่าเริ่มต้นของเกม ให้รัน `npm run build:apps-script` และอัปเดตไฟล์ใน Apps Script ด้วย

การทดสอบอัตโนมัติใช้เซิร์ฟเวอร์และ Google Sheets จำลอง ครอบคลุมสต็อก ข้อมูลชนกัน การเขียนขาดตอน การยืนยันผู้ดูแล และเครือข่ายล้มเหลว ต้องตรวจการเชื่อมต่อ Web App จริงหลังมีบัญชีและ URL

เอกสารอ้างอิง: [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content), [LockService](https://developers.google.com/apps-script/reference/lock/lock-service), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
