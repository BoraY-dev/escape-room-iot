// Test hardwaru rozšíření (2. fáze): LCD 1602, klávesnice 4x4, enkodér KY-040.
// Samostatný program jen pro oživení – hlavní firmware je v ../escape-node.
// Zapojení podle docs/03-application-model/iot-hardware.md (kap. 2, rozšíření).
//
// Co dělá:
//  - LCD: po startu ukáže "HW test" a řadu znaků (kontrola kontrastu),
//         řádek přijatý po sériové lince vypíše na 2. řádek LCD,
//  - klávesnice: stisk vypíše klávesu i řádek/sloupec (ověření zapojení),
//  - enkodér: otočení mění pozici (+/-), stisk osy hlásí SW.
// Vše se hlásí na LCD i po sériové lince (prostý text, jeden řádek na událost).

#include <LiquidCrystal.h>

const unsigned long SERIAL_BAUD = 9600;

// LCD 1602 ve 4bitovém režimu: RS, E, D4, D5, D6, D7
LiquidCrystal lcd(40, 41, 42, 43, 44, 45);

// Klávesnice 4x4: vývody 1–4 = řádky, 5–8 = sloupce
const uint8_t ROW_PINS[4] = {30, 31, 32, 33};
const uint8_t COL_PINS[4] = {34, 35, 36, 37};
const char KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};

// Enkodér KY-040
const uint8_t ENC_SW = 6, ENC_DT = 7, ENC_CLK = 8;

const unsigned long DEBOUNCE_MS = 30;
const unsigned long KEYPAD_PERIOD_MS = 5;

// --- stav ---
char keyRaw = 0, keyStable = 0;
uint8_t keyRow = 0, keyCol = 0;
unsigned long keyChangedMs = 0, lastScanMs = 0;

uint8_t encPrev = 0;          // poslední dva stavy (CLK, DT) jako 4 bity
int8_t encAcc = 0;            // součet kroků mezi zarážkami
long encPos = 0;

bool swRaw = HIGH, swStable = HIGH;
unsigned long swChangedMs = 0;

char rxBuf[17];
uint8_t rxLen = 0;

// --- LCD ---

// Vypíše text na řádek LCD a doplní mezerami (bez lcd.clear(), ten trvá 2 ms)
void lcdLine(uint8_t row, const char* text) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void showStatus() {
  char buf[17];
  snprintf(buf, sizeof(buf), "Key:%c Enc:%ld", keyStable ? keyStable : '-', encPos);
  lcdLine(0, buf);
}

// --- klávesnice ---

// Projde řádky: vždy jeden stáhne na LOW, sloupce s pull-upem čtou, kde je spojení
char scanKeypad(uint8_t& row, uint8_t& col) {
  char found = 0;
  for (uint8_t r = 0; r < 4 && !found; r++) {
    pinMode(ROW_PINS[r], OUTPUT);
    digitalWrite(ROW_PINS[r], LOW);
    delayMicroseconds(10);    // ustálení linky
    for (uint8_t c = 0; c < 4; c++) {
      if (digitalRead(COL_PINS[c]) == LOW) { found = KEYS[r][c]; row = r; col = c; break; }
    }
    pinMode(ROW_PINS[r], INPUT);  // řádek zpět do vysoké impedance
  }
  return found;
}

void updateKeypad(unsigned long now) {
  if (now - lastScanMs < KEYPAD_PERIOD_MS) return;
  lastScanMs = now;
  uint8_t r = 0, c = 0;
  char k = scanKeypad(r, c);
  if (k != keyRaw) { keyRaw = k; keyChangedMs = now; return; }
  if (k != keyStable && now - keyChangedMs >= DEBOUNCE_MS) {
    keyStable = k;
    if (k) {
      keyRow = r; keyCol = c;
      char buf[17];
      snprintf(buf, sizeof(buf), "KEY %c r%u c%u", k, r + 1, c + 1);
      Serial.println(buf);
      lcdLine(1, buf);
    }
    showStatus();
  }
}

// --- enkodér ---

// Kvadraturní dekodér: platný přechod = ±1, neplatný (zákmit) = 0.
// Jedna zarážka KY-040 = 4 přechody.
void updateEncoder() {
  static const int8_t TABLE[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  uint8_t ab = (digitalRead(ENC_CLK) << 1) | digitalRead(ENC_DT);
  encPrev = ((encPrev << 2) | ab) & 0x0F;
  encAcc += TABLE[encPrev];
  int8_t step = 0;
  if (encAcc >= 4) step = 1;
  else if (encAcc <= -4) step = -1;
  if (step) {
    encAcc = 0;
    encPos += step;
    char buf[17];
    snprintf(buf, sizeof(buf), "ENC %s pos=%ld", step > 0 ? "+1" : "-1", encPos);
    Serial.println(buf);
    lcdLine(1, buf);
    showStatus();
  }
}

void updateEncoderButton(unsigned long now) {
  bool v = digitalRead(ENC_SW);
  if (v != swRaw) { swRaw = v; swChangedMs = now; return; }
  if (v != swStable && now - swChangedMs >= DEBOUNCE_MS) {
    swStable = v;
    if (v == LOW) {
      Serial.println("ENC SW press");
      lcdLine(1, "ENC SW press");
    }
  }
}

// --- sériová linka → LCD ---

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      rxBuf[rxLen] = '\0';
      lcdLine(1, rxBuf);
      Serial.print("LCD <- ");
      Serial.println(rxBuf);
      rxLen = 0;
    } else if (rxLen < sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = ch;    // delší text se ořízne na 16 znaků
    }
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);

  for (uint8_t i = 0; i < 4; i++) {
    pinMode(ROW_PINS[i], INPUT);
    pinMode(COL_PINS[i], INPUT_PULLUP);
  }
  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT, INPUT_PULLUP);
  pinMode(ENC_SW, INPUT_PULLUP);   // SW na KY-040 často nemá vlastní pull-up
  encPrev = (digitalRead(ENC_CLK) << 1) | digitalRead(ENC_DT);

  lcd.begin(16, 2);
  lcdLine(0, "HW test");
  lcdLine(1, "0123456789ABCDEF");  // plný řádek: je vidět kontrast i všechny pozice
  Serial.println("READY hw-test (LCD, keypad, encoder)");
  delay(1500);
  showStatus();
  lcdLine(1, "");
}

void loop() {
  unsigned long now = millis();
  readSerial();
  updateEncoder();             // co nejčastěji, jinak se ztrácejí kroky
  updateKeypad(now);
  updateEncoderButton(now);
}
