const EventEmitter = require('events');
const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');

class SerialCommunication {
  constructor({ baudRate = 115200, path, readyCode, autoOpen = true}) {
    this.initialized = false;
    this.events = new EventEmitter();

    // https://serialport.io/docs/api-stream#constructor
    try {
      this.serialport = new SerialPort(path, {
        baudRate,
        autoOpen,
        openCallback: () => console.log('Open callback!'),
      });

      const lineParser = new Readline();
      this.serialport.pipe(lineParser);
      lineParser.on('data', (data) => {
        if (data === readyCode) {
          this.initialized = true;
          console.log('✅  UArm is READY.');
          this.events.emit('ready');
          return;
        }
        // UArm will send some device info before initialition code.
        if (!this.initialized) {
          console.log(`ℹ️  ${data}`);
          return;
        }
        this.events.emit('data', data);
      });
    }
    catch (error) {
      throw new Error(error);
    }
    // return this;
  }

  // Manually open if we don't autoOpen.
  open() {
    return new Promise((resolve, reject) => {
      try {
        this.serialport.open(() => {
          this.events.on('ready', () => {
            resolve();
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Send data (a line) on the serial port
  send(line) {
    if (!this.initialized) {
      console.log('send(): Not connected 😔');
      return;
    }

    this.serialport.write(`${line}\n`);
  }
}

module.exports = SerialCommunication;
