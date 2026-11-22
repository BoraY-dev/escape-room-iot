// Firmware IoT Node (Arduino Mega 2560).
// Návrh: docs/03-application-model/iot-node.md, zprávy: iot-protocol.md, zapojení: iot-hardware.md.
//
// Node neobsahuje herní logiku: hlásí události a vzorky a vykonává povely gateway.
// Smyčka neblokuje, každá úloha se plánuje podle millis().

#include <Wire.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <avr/wdt.h>
#include <math.h>
#include "config.h"
#if ENABLE_EXTENSIONS
#include <LiquidCrystal.h>
#endif

// ---------------------------------------------------------------------------
// Stav
// ---------------------------------------------------------------------------

DHT dht(PIN_DHT, DHT11);

uint16_t seq = 0;                       // pořadové číslo zprávy, přetéká přes 65535

char rxBuf[RX_BUFFER];
uint8_t rxLen = 0;
bool rxOverflow = false;                // příliš dlouhý řádek se zahazuje až do \n

struct Button {
  bool raw;
  bool stable;                          // stav po ošetření zákmitů
  unsigned long changedMs;
};
Button buttons[BUTTON_COUNT];
#if ENABLE_EXTENSIONS
Button encButton;
#endif

enum LedMode : uint8_t { LED_OFF, LED_ON, LED_BLINK };
LedMode ledModes[LED_COUNT];
bool blinkPhase = false;

bool accOk = false;
float fx = 0, fy = 0, fz = 1;           // zrychlení po dolní propusti
bool filterReady = false;
bool tiltForce = true;                  // další náklon odeslat bez ohledu na pásmo necitlivosti
int lastTiltSent = 0;

bool tempOk = false;
uint8_t tempFails = 0;

unsigned long lastAccelMs = 0, lastTempMs = 0, lastHbMs = 0, lastBlinkMs = 0;
unsigned long lastTiltMs = 0, lastMoveMs = 0, lastAccRetryMs = 0;

#if ENABLE_EXTENSIONS
// Konstruktor nastaví RS a E jako výstupy, proto objekt existuje jen s rozšířením.
LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_E, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

char keyRaw = 0, keyStable = 0;         // 0 = žádná klávesa
unsigned long keyChangedMs = 0, lastKeypadMs = 0;
char code[CODE_MAX_LEN + 1];
uint8_t codeLen = 0;

uint8_t encPrev = 0;                    // poslední dva stavy (CLK, DT) jako 4 bity
int8_t encAcc = 0;                      // přechody od poslední zarážky
uint8_t encPos = 0;
bool encDirty = false;                  // změna polohy čeká na odeslání
unsigned long lastEncReportMs = 0, lastEncMoveMs = 0;
#endif

// ---------------------------------------------------------------------------
// Odesílání zpráv
// ---------------------------------------------------------------------------

// hwId ve tvaru <NODE_ID>.<zařízení>, např. node1.btn2
void makeId(char* out, size_t size, const char* device) {
  snprintf(out, size, "%s.%s", NODE_ID, device);
}

// Jeden JSON objekt na řádek; seq nese každá zpráva kromě hello.
void send(JsonDocument& doc, bool withSeq = true) {
  if (withSeq) doc["seq"] = seq++;
  serializeJson(doc, Serial);
  Serial.write('\n');
}

void addDevice(JsonArray devices, const char* device, const char* type) {
  char id[24];
  makeId(id, sizeof(id), device);
  JsonObject d = devices.add<JsonObject>();
  d["id"] = id;
  d["type"] = type;
}

// Ohlásí jen zařízení, která právě fungují.
void sendHello() {
  JsonDocument doc;
  doc["t"] = "hello";
  doc["node"] = NODE_ID;
  doc["fw"] = FW_VERSION;
  JsonArray devices = doc["devices"].to<JsonArray>();
  char name[8];
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    snprintf(name, sizeof(name), "btn%u", i + 1);
    addDevice(devices, name, "button");
  }
  if (accOk) addDevice(devices, "acc1", "accelerometer");
  if (tempOk) addDevice(devices, "temp1", "thermometer");
  for (uint8_t i = 0; i < LED_COUNT; i++) {
    snprintf(name, sizeof(name), "led%u", i + 1);
    addDevice(devices, name, "led");
  }
#if ENABLE_EXTENSIONS
  // Přítomnost těchto zařízení nelze zjistit (LCD je zapojený jen pro zápis), ohlašují se vždy.
  addDevice(devices, "kp1", "keypad");
  addDevice(devices, "enc1", "encoder");
  addDevice(devices, "lcd1", "display");
#endif
  send(doc, false);
}

void sendEvent(const char* device, const char* event, bool withValue = false, int value = 0) {
  char id[24];
  makeId(id, sizeof(id), device);
  JsonDocument doc;
  doc["t"] = "ev";
  doc["id"] = id;
  doc["e"] = event;
  if (withValue) doc["v"] = value;
  send(doc);
}

void sendEventText(const char* device, const char* event, const char* value) {
  char id[24];
  makeId(id, sizeof(id), device);
  JsonDocument doc;
  doc["t"] = "ev";
  doc["id"] = id;
  doc["e"] = event;
  doc["v"] = value;
  send(doc);
}

// device == nullptr: chyba celého nodu
void sendErr(const char* device, const char* code) {
  char id[24];
  if (device) makeId(id, sizeof(id), device);
  else strlcpy(id, NODE_ID, sizeof(id));
  JsonDocument doc;
  doc["t"] = "err";
  doc["id"] = id;
  doc["code"] = code;
  send(doc);
}

void sendAck(const char* cid, bool ok, const char* err = nullptr) {
  char cidCopy[12];
  strlcpy(cidCopy, cid, sizeof(cidCopy));
  JsonDocument doc;
  doc["t"] = "ack";
  doc["cid"] = cidCopy;
  doc["ok"] = ok;
  if (err) doc["err"] = err;
  send(doc);
}

void sendHeartbeat(unsigned long now) {
  JsonDocument doc;
  doc["t"] = "hb";
  doc["node"] = NODE_ID;
  doc["up"] = now / 1000;
  send(doc);
}

// ---------------------------------------------------------------------------
// Tlačítka
// ---------------------------------------------------------------------------

// Převezme aktuální stav bez hlášení, aby se držené tlačítko po startu nebo resetu neohlásilo.
void syncButtons(unsigned long now) {
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    bool v = digitalRead(PIN_BUTTONS[i]);
    buttons[i] = {v, v, now};
  }
}

// Vrací true jen v okamžiku stisku po ošetření zákmitů. Vstupy mají pull-up, stisk je LOW.
bool pressedNow(Button& b, uint8_t pin, unsigned long now) {
  bool v = digitalRead(pin);
  if (v != b.raw) {
    b.raw = v;
    b.changedMs = now;
  } else if (v != b.stable && now - b.changedMs >= DEBOUNCE_MS) {
    b.stable = v;
    return v == LOW;
  }
  return false;
}

void updateButtons(unsigned long now) {
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    if (pressedNow(buttons[i], PIN_BUTTONS[i], now)) {
      char name[8];
      snprintf(name, sizeof(name), "btn%u", i + 1);
      sendEvent(name, "press");
    }
  }
}

// ---------------------------------------------------------------------------
// Akcelerometr GY-521 (MPU-6050), přímý přístup k registrům
// ---------------------------------------------------------------------------

const uint8_t REG_ACCEL_XOUT_H = 0x3B;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_PWR_MGMT_1   = 0x6B;
const uint8_t REG_WHO_AM_I     = 0x75;

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuRead(uint8_t reg, uint8_t* buf, uint8_t count) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) buf[i] = Wire.read();
  return true;
}

bool initAccel() {
  uint8_t who;
  if (!mpuWrite(REG_PWR_MGMT_1, 0x00)) return false;     // probuzení ze sleep
  if (!mpuWrite(REG_ACCEL_CONFIG, 0x00)) return false;   // rozsah ±2 g
  if (!mpuRead(REG_WHO_AM_I, &who, 1)) return false;
  // Klony modulu (MPU-6500 aj.) vracejí jiné WHO_AM_I než 0x68, registry zrychlení jsou shodné.
  // Za chybu se proto považuje jen sběrnice bez odpovědi.
  if (who == 0x00 || who == 0xFF) return false;
  filterReady = false;
  tiltForce = true;
  return true;
}

void accelFailed(unsigned long now) {
  accOk = false;
  lastAccRetryMs = now;
  sendErr("acc1", "sensorNotResponding");
  sendHello();
}

int16_t toInt16(uint8_t hi, uint8_t lo) {
  return (int16_t)(((uint16_t)hi << 8) | lo);
}

void updateAccelerometer(unsigned long now) {
  if (!accOk) return;
  uint8_t b[6];
  if (!mpuRead(REG_ACCEL_XOUT_H, b, 6)) { accelFailed(now); return; }

  const float LSB_PER_G = 16384.0;      // pro rozsah ±2 g
  float ax = toInt16(b[0], b[1]) / LSB_PER_G;
  float ay = toInt16(b[2], b[3]) / LSB_PER_G;
  float az = toInt16(b[4], b[5]) / LSB_PER_G;

  // Pohyb: velikost zrychlení se odchýlí od klidové hodnoty 1 g.
  float mag = sqrt(ax * ax + ay * ay + az * az);
  if (fabs(mag - 1.0) > MOVE_THRESHOLD_G && now - lastMoveMs >= MOVE_COOLDOWN_MS) {
    lastMoveMs = now;
    sendEvent("acc1", "move");
  }

  // Náklon: úhel mezi osou Z a svislicí z vyhlazeného vektoru.
  if (!filterReady) { fx = ax; fy = ay; fz = az; filterReady = true; }
  else {
    fx = 0.8 * fx + 0.2 * ax;
    fy = 0.8 * fy + 0.2 * ay;
    fz = 0.8 * fz + 0.2 * az;
  }
  float fmag = sqrt(fx * fx + fy * fy + fz * fz);
  if (fmag < 0.1) return;               // volný pád, směr nelze určit
  float c = constrain(fz / fmag, -1.0, 1.0);
  int tilt = (int)lround(acos(c) * 180.0 / M_PI);

  bool changed = tiltForce || abs(tilt - lastTiltSent) >= TILT_DEADBAND_DEG;
  if (changed && now - lastTiltMs >= TILT_MIN_INTERVAL_MS) {
    lastTiltSent = tilt;
    lastTiltMs = now;
    tiltForce = false;
    sendEvent("acc1", "tilt", true, tilt);
  }
}

// ---------------------------------------------------------------------------
// Teploměr DHT11
// ---------------------------------------------------------------------------

// Čtení trvá přibližně 25 ms a knihovna během přenosu zakazuje přerušení (iot-node.md kap. 5).
void sampleTemperature() {
  float t = dht.readTemperature();
  if (isnan(t)) {
    sendErr("temp1", "sensorNotResponding");
    if (tempFails < 255) tempFails++;
    if (tempOk && tempFails >= TEMP_FAIL_LIMIT) { tempOk = false; sendHello(); }
    return;
  }
  tempFails = 0;
  if (!tempOk) { tempOk = true; sendHello(); }
  if (t < TEMP_MIN_C || t > TEMP_MAX_C) { sendErr("temp1", "sensorOutOfRange"); return; }

  char id[24];
  makeId(id, sizeof(id), "temp1");
  JsonDocument doc;
  doc["t"] = "m";
  doc["id"] = id;
  doc["v"] = (int)lround(t);            // rozlišení DHT11 je 1 °C
  send(doc);
}

// ---------------------------------------------------------------------------
// LED
// ---------------------------------------------------------------------------

void applyLeds() {
  for (uint8_t i = 0; i < LED_COUNT; i++) {
    bool on = ledModes[i] == LED_ON || (ledModes[i] == LED_BLINK && blinkPhase);
    digitalWrite(PIN_LEDS[i], on ? HIGH : LOW);
  }
}

void updateLedBlink(unsigned long now) {
  if (now - lastBlinkMs >= BLINK_HALF_PERIOD_MS) {
    lastBlinkMs = now;
    blinkPhase = !blinkPhase;
    applyLeds();
  }
}

int ledIndex(const char* id) {
  char expected[24];
  for (uint8_t i = 0; i < LED_COUNT; i++) {
    char name[8];
    snprintf(name, sizeof(name), "led%u", i + 1);
    makeId(expected, sizeof(expected), name);
    if (strcmp(id, expected) == 0) return i;
  }
  return -1;
}

#if ENABLE_EXTENSIONS
// ---------------------------------------------------------------------------
// Klávesnice 4x4 (kp1)
// ---------------------------------------------------------------------------

// Aktivní řádek je výstup LOW, ostatní zůstávají vstupy s vysokou impedancí,
// takže současný stisk dvou kláves nezkratuje výstupy.
char scanKeypad() {
  for (uint8_t r = 0; r < 4; r++) {
    pinMode(PIN_KEYPAD_ROWS[r], OUTPUT);
    digitalWrite(PIN_KEYPAD_ROWS[r], LOW);
    delayMicroseconds(10);
    for (uint8_t c = 0; c < 4; c++) {
      if (digitalRead(PIN_KEYPAD_COLS[c]) == LOW) {
        pinMode(PIN_KEYPAD_ROWS[r], INPUT);
        return KEYPAD_KEYS[r][c];
      }
    }
    pinMode(PIN_KEYPAD_ROWS[r], INPUT);
  }
  return 0;
}

// Každý stisk se hlásí jako key. '*' maže rozepsaný kód, '#' ho odešle jako code.
// Správnost kódu vyhodnocuje gateway.
void handleKey(char k) {
  char keyText[2] = {k, '\0'};
  sendEventText("kp1", "key", keyText);
  if (k == '*') {
    codeLen = 0;
  } else if (k == '#') {
    if (codeLen > 0) {
      code[codeLen] = '\0';
      sendEventText("kp1", "code", code);
      codeLen = 0;
    }
  } else if (codeLen < CODE_MAX_LEN) {
    code[codeLen++] = k;
  }
}

void updateKeypad(unsigned long now) {
  if (now - lastKeypadMs < KEYPAD_PERIOD_MS) return;
  lastKeypadMs = now;
  char k = scanKeypad();
  if (k != keyRaw) { keyRaw = k; keyChangedMs = now; return; }
  if (k == keyStable || now - keyChangedMs < DEBOUNCE_MS) return;
  keyStable = k;
  if (k) handleKey(k);
}

// ---------------------------------------------------------------------------
// Enkodér KY-040 (enc1)
// ---------------------------------------------------------------------------

uint8_t readEncoderPins() {
  return (digitalRead(PIN_ENC_CLK) << 1) | digitalRead(PIN_ENC_DT);
}

// Kvadraturní dekodér s tabulkou přechodů: platný přechod dává ±1, neplatný (zákmit) 0.
// Jedna zarážka odpovídá čtyřem přechodům. D6–D8 nemají přerušení, proto se volá v každém průchodu loop().
// Poloha se posílá absolutně, takže ztracená zpráva neovlivní další.
void updateEncoder(unsigned long now) {
  static const int8_t TABLE[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  encPrev = ((encPrev << 2) | readEncoderPins()) & 0x0F;
  encAcc += TABLE[encPrev];
  if (encAcc >= 4 || encAcc <= -4) {
    int8_t step = encAcc > 0 ? 1 : -1;
    encAcc = 0;
    if (ENC_REVERSE) step = -step;
    encPos = (encPos + ENC_POSITIONS + step) % ENC_POSITIONS;
    encDirty = true;
    lastEncMoveMs = now;
  }
  if (encDirty && now - lastEncReportMs >= ENC_REPORT_MS) {
    encDirty = false;
    lastEncReportMs = now;
    sendEvent("enc1", "turn", true, encPos);
  }
  if (pressedNow(encButton, PIN_ENC_SW, now)) sendEvent("enc1", "press");
}

// ---------------------------------------------------------------------------
// LCD 1602 (lcd1)
// ---------------------------------------------------------------------------

// Přepíše celý řádek doplněný mezerami; lcd.clear() trvá 2 ms a způsobuje blikání.
// Displej zobrazí jen ASCII: znak UTF-8 se nahradí '?', řídicí znaky mezerou.
void lcdShow(uint8_t row, const char* text) {
  char buf[LCD_COLS + 1];
  uint8_t n = 0;
  for (const uint8_t* p = (const uint8_t*)text; *p && n < LCD_COLS; p++) {
    if (*p < 0x80) buf[n++] = *p >= 0x20 ? (char)*p : ' ';
    else if ((*p & 0xC0) == 0xC0) buf[n++] = '?';   // úvodní bajt UTF-8; pokračovací bajty se přeskočí
  }
  while (n < LCD_COLS) buf[n++] = ' ';
  buf[n] = '\0';
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void setupExtensions(unsigned long now) {
  for (uint8_t i = 0; i < 4; i++) {
    pinMode(PIN_KEYPAD_ROWS[i], INPUT);
    pinMode(PIN_KEYPAD_COLS[i], INPUT_PULLUP);
  }
  pinMode(PIN_ENC_CLK, INPUT_PULLUP);
  pinMode(PIN_ENC_DT, INPUT_PULLUP);
  pinMode(PIN_ENC_SW, INPUT_PULLUP);    // moduly KY-040 mají pull-up obvykle jen na CLK a DT
  lcd.begin(LCD_COLS, LCD_ROWS);
  lcdShow(0, NODE_ID " fw " FW_VERSION);
  lcdShow(1, "");
  resetExtensions(now);
}

// Výchozí stav po startu a po povelu reset. Držená klávesa ani tlačítko se neohlásí jako nový stisk.
void resetExtensions(unsigned long now) {
  codeLen = 0;
  keyRaw = keyStable = scanKeypad();
  keyChangedMs = now;
  encPrev = readEncoderPins();
  encAcc = 0;
  encPos = 0;
  encDirty = false;
  bool sw = digitalRead(PIN_ENC_SW);
  encButton = {sw, sw, now};
}
#endif

// ---------------------------------------------------------------------------
// Povely od gateway
// ---------------------------------------------------------------------------

void resetState(unsigned long now) {
  for (uint8_t i = 0; i < LED_COUNT; i++) ledModes[i] = LED_OFF;
  applyLeds();
  tiltForce = true;
  syncButtons(now);
#if ENABLE_EXTENSIONS
  lcdShow(0, "");
  lcdShow(1, "");
  resetExtensions(now);
#endif
}

bool isDevice(const char* id, const char* device) {
  char expected[24];
  makeId(expected, sizeof(expected), device);
  return strcmp(id, expected) == 0;
}

// Povely nastavují absolutní stav, opakované doručení je proto neškodné.
void handleCommand(char* line) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, line);
  const char* cid = doc["cid"];
  if (error || cid == nullptr) {        // bez cid nelze odpovědět ack
    sendErr(nullptr, "badMessage");
    return;
  }
  const char* t = doc["t"] | "";

  if (strcmp(t, "led") == 0) {
    int idx = ledIndex(doc["id"] | "");
    if (idx < 0) { sendAck(cid, false, "unknownDevice"); return; }
    const char* s = doc["s"] | "";
    LedMode mode;
    if (strcmp(s, "on") == 0) mode = LED_ON;
    else if (strcmp(s, "off") == 0) mode = LED_OFF;
    else if (strcmp(s, "blink") == 0) mode = LED_BLINK;
    else { sendAck(cid, false, "badMessage"); return; }
    ledModes[idx] = mode;
    applyLeds();
    sendAck(cid, true);
  } else if (strcmp(t, "reset") == 0) {
    resetState(millis());
    sendAck(cid, true);
  } else if (strcmp(t, "who") == 0) {
    sendAck(cid, true);
    sendHello();
  } else if (strcmp(t, "lcd") == 0) {
#if ENABLE_EXTENSIONS
    if (!isDevice(doc["id"] | "", "lcd1")) { sendAck(cid, false, "unknownDevice"); return; }
    lcdShow(0, doc["l1"] | "");         // chybějící řádek se smaže
    lcdShow(1, doc["l2"] | "");
    sendAck(cid, true);
#else
    sendAck(cid, false, "unknownDevice");
#endif
  } else {
    sendAck(cid, false, "unknownCommand");
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (rxOverflow) { rxOverflow = false; sendErr(nullptr, "badMessage"); }
      else if (rxLen > 0) { rxBuf[rxLen] = '\0'; handleCommand(rxBuf); }
      rxLen = 0;
      continue;
    }
    if (rxOverflow) continue;
    if (rxLen < RX_BUFFER - 1) rxBuf[rxLen++] = c;
    else rxOverflow = true;
  }
}

// ---------------------------------------------------------------------------
// Chyby senzorů
// ---------------------------------------------------------------------------

void checkSensorHealth(unsigned long now) {
  if (!accOk && now - lastAccRetryMs >= SENSOR_RETRY_MS) {
    lastAccRetryMs = now;
    if (initAccel()) { accOk = true; sendHello(); }
    else sendErr("acc1", "sensorNotResponding");
  }
}

// ---------------------------------------------------------------------------
// Start a hlavní smyčka
// ---------------------------------------------------------------------------

void setup() {
  // Watchdog zůstává po resetu aktivní; bez vypnutí by restartoval už během setup().
  MCUSR = 0;
  wdt_disable();

  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  Wire.setWireTimeout(3000, true);      // nereagující I2C nesmí zablokovat smyčku
  dht.begin();

  for (uint8_t i = 0; i < BUTTON_COUNT; i++) pinMode(PIN_BUTTONS[i], INPUT_PULLUP);
  for (uint8_t i = 0; i < LED_COUNT; i++) { pinMode(PIN_LEDS[i], OUTPUT); ledModes[i] = LED_OFF; }
  applyLeds();
  syncButtons(millis());
#if ENABLE_EXTENSIONS
  setupExtensions(millis());
#endif

  accOk = initAccel();

  delay(1000);                          // DHT11 vyžaduje po zapnutí ~1 s; watchdog ještě neběží
  tempOk = !isnan(dht.readTemperature());

  wdt_enable(WDTO_2S);

  sendHello();
  if (!accOk) sendErr("acc1", "sensorNotResponding");

  unsigned long now = millis();
  lastAccelMs = lastHbMs = lastBlinkMs = lastAccRetryMs = now;
  lastTempMs = now;
}

// Rozdíly now - last* jsou správně i po přetečení millis() (~49 dní).
void loop() {
  wdt_reset();
  unsigned long now = millis();

  readSerialCommands();
  updateButtons(now);
#if ENABLE_EXTENSIONS
  updateEncoder(now);
  updateKeypad(now);
  // Čtení DHT11 blokuje ~25 ms a enkodér by ztrácel kroky; během otáčení se odkládá.
  bool tempAllowed = now - lastEncMoveMs >= ENC_QUIET_MS;
#else
  bool tempAllowed = true;
#endif
  if (now - lastAccelMs >= ACCEL_PERIOD_MS) { lastAccelMs = now; updateAccelerometer(now); }
  if (tempAllowed && now - lastTempMs >= TEMP_PERIOD_MS) { lastTempMs = now; sampleTemperature(); }
  if (now - lastHbMs    >= HB_PERIOD_MS)    { lastHbMs    = now; sendHeartbeat(now); }
  updateLedBlink(now);
  checkSensorHealth(now);
}
