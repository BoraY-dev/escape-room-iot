// Konfigurace IoT Node: identifikace, piny, komunikace a časování.
// Zapojení: docs/03-application-model/iot-hardware.md, parametry: iot-node.md kap. 2.
#pragma once

#define NODE_ID     "node1"   // prefix všech hwId; každý node v místnosti musí mít jiný
#define FW_VERSION  "1.1.0"

// Obsluha klávesnice, enkodéru a LCD (2. fáze, iot-protocol.md kap. 9).
// Vyžaduje gateway, která zná typy keypad, encoder a display; starší gateway odmítne celé hello.
// Lze nastavit i při překladu: -DENABLE_EXTENSIONS=1
#ifndef ENABLE_EXTENSIONS
#define ENABLE_EXTENSIONS 0
#endif

// Piny: MVP
const uint8_t PIN_BUTTONS[] = {2, 3, 4};    // btn1–btn3
const uint8_t PIN_LEDS[]    = {22, 23};     // led1 zelená, led2 červená
const uint8_t PIN_DHT       = 5;
// GY-521 je na hardwarovém I2C (SDA 20, SCL 21).

// Piny: rozšíření
const uint8_t PIN_KEYPAD_ROWS[] = {30, 31, 32, 33};
const uint8_t PIN_KEYPAD_COLS[] = {34, 35, 36, 37};
const char KEYPAD_KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
const uint8_t PIN_ENC_SW  = 6;
const uint8_t PIN_ENC_DT  = 7;
const uint8_t PIN_ENC_CLK = 8;
const uint8_t PIN_LCD_RS = 40, PIN_LCD_E = 41;                    // LCD 1602 ve 4bitovém režimu
const uint8_t PIN_LCD_D4 = 42, PIN_LCD_D5 = 43, PIN_LCD_D6 = 44, PIN_LCD_D7 = 45;

const uint8_t BUTTON_COUNT = sizeof(PIN_BUTTONS);
const uint8_t LED_COUNT    = sizeof(PIN_LEDS);

const uint8_t MPU_ADDR = 0x68;              // AD0 nezapojeno

// Komunikace
const unsigned long SERIAL_BAUD = 115200;   // musí odpovídat gateway
const uint8_t RX_BUFFER = 128;              // nejdelší povel včetně \n (limit protokolu)

// Časování a prahy
const unsigned long DEBOUNCE_MS          = 30;
const unsigned long ACCEL_PERIOD_MS      = 50;     // 20 Hz
const int           TILT_DEADBAND_DEG    = 5;      // menší změny náklonu se neposílají
const unsigned long TILT_MIN_INTERVAL_MS = 200;
const float         MOVE_THRESHOLD_G     = 0.3;    // odchylka velikosti zrychlení od 1 g
const unsigned long MOVE_COOLDOWN_MS     = 1000;
const unsigned long TEMP_PERIOD_MS       = 10000;  // DHT11 dovoluje nejvýš jedno čtení za 2 s
const uint8_t       TEMP_FAIL_LIMIT      = 3;      // po tolika chybách po sobě se teploměr vyřadí z hello
const int           TEMP_MIN_C           = 0;      // měřicí rozsah DHT11
const int           TEMP_MAX_C           = 50;
const unsigned long HB_PERIOD_MS         = 5000;
const unsigned long SENSOR_RETRY_MS      = 5000;   // opakovaná inicializace GY-521
const unsigned long BLINK_HALF_PERIOD_MS = 500;    // 1 Hz

// Časování a prahy: rozšíření
const unsigned long KEYPAD_PERIOD_MS = 5;
const uint8_t       CODE_MAX_LEN     = 8;          // delší vstup se ořízne
const uint8_t       ENC_POSITIONS    = 20;         // zarážek na otáčku KY-040; poloha se počítá modulo
const bool          ENC_REVERSE      = true;       // podle orientace vývodů; otáčením doprava má poloha růst
const unsigned long ENC_REPORT_MS    = 100;        // nejkratší interval zpráv turn
const unsigned long ENC_QUIET_MS     = 1000;       // odklad čtení DHT11 po pohybu enkodéru, viz loop()
const uint8_t       LCD_COLS = 16, LCD_ROWS = 2;
