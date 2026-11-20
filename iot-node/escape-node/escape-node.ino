// Firmware IoT Node – Arduino Mega 2560
// Návrh: docs/03-application-model/iot-node.md, formát zpráv: iot-protocol.md, zapojení: iot-hardware.md.
// Node o hře nic neví: hlásí události a vzorky, vykonává povely gateway (LED, reset, who).
// Program nikde nečeká – každá úloha v loop() si podle millis() hlídá svůj čas.

#include <Wire.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <avr/wdt.h>
#include <math.h>
#include "config.h"

// ---------------------------------------------------------------------------
// Stav
// ---------------------------------------------------------------------------

DHT dht(PIN_DHT, DHT11);

uint16_t seq = 0;                       // pořadové číslo zpráv (0–65535, pak znovu od 0)

char rxBuf[RX_BUFFER];                  // příjem povelu do \n
uint8_t rxLen = 0;
bool rxOverflow = false;                // řádek je delší než buffer → zahazujeme do \n

struct Button {
  bool raw;                             // poslední přečtená hodnota
  bool stable;                          // hodnota uznaná po ošetření zákmitů
  unsigned long changedMs;              // kdy se raw naposledy změnila
};
Button buttons[BUTTON_COUNT];

enum LedMode : uint8_t { LED_OFF, LED_ON, LED_BLINK };
LedMode ledModes[LED_COUNT];
bool blinkPhase = false;

bool accOk = false;                     // GY-521 odpovídá
float fx = 0, fy = 0, fz = 1;           // vyhlazené zrychlení (plovoucí průměr)
bool filterReady = false;
bool tiltForce = true;                  // další tilt poslat hned (start, reset, obnova senzoru)
int lastTiltSent = 0;

bool tempOk = false;                    // DHT11 vrací hodnoty
uint8_t tempFails = 0;                  // neúspěšná čtení po sobě

unsigned long lastAccelMs = 0, lastTempMs = 0, lastHbMs = 0, lastBlinkMs = 0;
unsigned long lastTiltMs = 0, lastMoveMs = 0, lastAccRetryMs = 0;

// ---------------------------------------------------------------------------
// Odesílání zpráv
// ---------------------------------------------------------------------------

// hwId = "<NODE_ID>.<zařízení>", např. node1.btn2
void makeId(char* out, size_t size, const char* device) {
  snprintf(out, size, "%s.%s", NODE_ID, device);
}

// Jediná cesta ven: doplní seq (kromě hello), zprávu pošle jako jeden řádek ukončený \n
void send(JsonDocument& doc, bool withSeq = true) {
  if (withSeq) doc["seq"] = seq++;
  serializeJson(doc, Serial);
  Serial.write('\n');
}

void addDevice(JsonArray devices, const char* device, const char* type) {
  char id[24];
  makeId(id, sizeof(id), device);
  JsonObject d = devices.add<JsonObject>();
  d["id"] = id;                         // char[] se do dokumentu kopíruje
  d["type"] = type;
}

// hello obsahuje jen funkční zařízení
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

// device = nullptr → chyba celého nodu (id = NODE_ID)
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

// Načte aktuální stav bez hlášení (start a reset) – držené tlačítko se nesmí ohlásit jako nový stisk
void syncButtons(unsigned long now) {
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    bool v = digitalRead(PIN_BUTTONS[i]);
    buttons[i] = {v, v, now};
  }
}

void updateButtons(unsigned long now) {
  for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
    bool v = digitalRead(PIN_BUTTONS[i]);
    if (v != buttons[i].raw) {
      buttons[i].raw = v;               // změna → začni měřit stabilitu znovu
      buttons[i].changedMs = now;
    } else if (v != buttons[i].stable && now - buttons[i].changedMs >= DEBOUNCE_MS) {
      buttons[i].stable = v;            // hodnota drží 30 ms → uznat
      if (v == LOW) {                   // stisk (INPUT_PULLUP: stisknuto = LOW); uvolnění se nehlásí
        char name[8];
        snprintf(name, sizeof(name), "btn%u", i + 1);
        sendEvent(name, "press");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Akcelerometr GY-521 (MPU-6050), čtení přímo přes registry
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
  if (!mpuWrite(REG_PWR_MGMT_1, 0x00)) return false;     // probudit čip
  if (!mpuWrite(REG_ACCEL_CONFIG, 0x00)) return false;   // rozsah ±2 g
  if (!mpuRead(REG_WHO_AM_I, &who, 1)) return false;
  // MPU-6050 vrací 0x68; klony na modulech GY-521 (MPU-6500 apod.) vrací jinou hodnotu,
  // registry zrychlení mají stejné. Chyba je jen „nic neodpovídá“.
  if (who == 0x00 || who == 0xFF) return false;
  filterReady = false;
  tiltForce = true;
  return true;
}

void accelFailed(unsigned long now) {
  accOk = false;
  lastAccRetryMs = now;
  sendErr("acc1", "sensorNotResponding");
  sendHello();                          // acc1 už v seznamu není
}

int16_t toInt16(uint8_t hi, uint8_t lo) {
  return (int16_t)(((uint16_t)hi << 8) | lo);
}

void updateAccelerometer(unsigned long now) {
  if (!accOk) return;
  uint8_t b[6];
  if (!mpuRead(REG_ACCEL_XOUT_H, b, 6)) { accelFailed(now); return; }

  const float LSB_PER_G = 16384.0;      // rozsah ±2 g
  float ax = toInt16(b[0], b[1]) / LSB_PER_G;
  float ay = toInt16(b[2], b[3]) / LSB_PER_G;
  float az = toInt16(b[4], b[5]) / LSB_PER_G;

  // Pohyb: v klidu je |a| = 1 g (gravitace)
  float mag = sqrt(ax * ax + ay * ay + az * az);
  if (fabs(mag - 1.0) > MOVE_THRESHOLD_G && now - lastMoveMs >= MOVE_COOLDOWN_MS) {
    lastMoveMs = now;
    sendEvent("acc1", "move");
  }

  // Náklon: vyhlazení každé osy, pak úhel mezi osou Z a svislicí
  if (!filterReady) { fx = ax; fy = ay; fz = az; filterReady = true; }
  else {
    fx = 0.8 * fx + 0.2 * ax;
    fy = 0.8 * fy + 0.2 * ay;
    fz = 0.8 * fz + 0.2 * az;
  }
  float fmag = sqrt(fx * fx + fy * fy + fz * fz);
  if (fmag < 0.1) return;               // volný pád / nesmyslná hodnota – náklon nelze určit
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

// Čtení trvá asi 25 ms a knihovna při přenosu na pár ms vypne přerušení (viz iot-node.md kap. 5)
void sampleTemperature() {
  float t = dht.readTemperature();
  if (isnan(t)) {                       // senzor neodpověděl
    sendErr("temp1", "sensorNotResponding");
    if (tempFails < 255) tempFails++;
    if (tempOk && tempFails >= TEMP_FAIL_LIMIT) { tempOk = false; sendHello(); }
    return;
  }
  tempFails = 0;
  if (!tempOk) { tempOk = true; sendHello(); }   // obnova senzoru
  if (t < TEMP_MIN_C || t > TEMP_MAX_C) { sendErr("temp1", "sensorOutOfRange"); return; }

  char id[24];
  makeId(id, sizeof(id), "temp1");
  JsonDocument doc;
  doc["t"] = "m";
  doc["id"] = id;
  doc["v"] = (int)lround(t);            // DHT11 měří v celých °C
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

// ---------------------------------------------------------------------------
// Povely od gateway
// ---------------------------------------------------------------------------

void resetState(unsigned long now) {
  for (uint8_t i = 0; i < LED_COUNT; i++) ledModes[i] = LED_OFF;
  applyLeds();
  tiltForce = true;                     // další tilt se pošle hned
  syncButtons(now);
}

void handleCommand(char* line) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, line);
  const char* cid = doc["cid"];
  if (error || cid == nullptr) {        // není na co odpovědět ack
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
    ledModes[idx] = mode;               // absolutní stav – opakovaný povel nic nepokazí
    applyLeds();
    sendAck(cid, true);
  } else if (strcmp(t, "reset") == 0) {
    resetState(millis());
    sendAck(cid, true);
  } else if (strcmp(t, "who") == 0) {
    sendAck(cid, true);
    sendHello();
  } else {
    sendAck(cid, false, "unknownCommand");
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;            // tolerance CRLF
    if (c == '\n') {
      if (rxOverflow) { rxOverflow = false; sendErr(nullptr, "badMessage"); }
      else if (rxLen > 0) { rxBuf[rxLen] = '\0'; handleCommand(rxBuf); }
      rxLen = 0;
      continue;
    }
    if (rxOverflow) continue;           // zahazujeme do nejbližšího \n
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
  MCUSR = 0;                            // po restartu watchdogem ho hned vypnout,
  wdt_disable();                        // jinak by restartoval i během setup()

  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  Wire.setWireTimeout(3000, true);      // 3 ms: nereagující I2C nesmí zaseknout smyčku
  dht.begin();

  for (uint8_t i = 0; i < BUTTON_COUNT; i++) pinMode(PIN_BUTTONS[i], INPUT_PULLUP);
  for (uint8_t i = 0; i < LED_COUNT; i++) { pinMode(PIN_LEDS[i], OUTPUT); ledModes[i] = LED_OFF; }
  applyLeds();
  syncButtons(millis());

  accOk = initAccel();

  delay(1000);                          // DHT11 potřebuje po zapnutí ~1 s (jediné čekání, ještě před watchdogem)
  tempOk = !isnan(dht.readTemperature());

  wdt_enable(WDTO_2S);

  sendHello();
  if (!accOk) sendErr("acc1", "sensorNotResponding");

  unsigned long now = millis();
  lastAccelMs = lastHbMs = lastBlinkMs = lastAccRetryMs = now;
  lastTempMs = now;                     // první vzorek teploty za 10 s
}

void loop() {
  wdt_reset();                          // watchdog: smyčka běží
  unsigned long now = millis();

  readSerialCommands();
  updateButtons(now);
  if (now - lastAccelMs >= ACCEL_PERIOD_MS) { lastAccelMs = now; updateAccelerometer(now); }
  if (now - lastTempMs  >= TEMP_PERIOD_MS)  { lastTempMs  = now; sampleTemperature(); }
  if (now - lastHbMs    >= HB_PERIOD_MS)    { lastHbMs    = now; sendHeartbeat(now); }
  updateLedBlink(now);
  checkSensorHealth(now);
  // Odčítání now - last… funguje i po přetečení millis() (asi po 49 dnech).
}
