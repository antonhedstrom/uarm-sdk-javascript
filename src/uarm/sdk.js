const SerialCommunication = require('../comm/serial-comm');
const {
  LOG_LEVEL,
  SERVO_HAND,
  MESSAGE_TICKING_FEEDBACK_PREFIX,
  TICKING_UARM_READY,
  MESSAGE_GCODE_SEND_PREFIX,
  MESSAGE_GCODE_RECEIVE_PREFIX,
  SPEED_DEFAULT,
  MESSAGE_ERROR_PREFIX,
  CARTESIAN_MODE,
} = require('./constants');

const ERRORS = require('./errors');

class uArmSDK {
  constructor({ port, onError, autoOpen = true, defaultSpeed }) {
    this.messageId = 1; // Bump by one for every message.
    this.waitingResponses = {}; // Object containing all unresponded messages.

    this.defaultSpeed = defaultSpeed || SPEED_DEFAULT;
    this.onError = console.error;
    if (onError) {
      if (typeof onError !== 'function') {
        throw new TypeError(`onError is not a function, got '${typeof onError}'`);
      }
      this.onError = onError;
    }
    this.serialPort = new SerialCommunication({
      path: port.comName,
      baudRate: 115200,
      autoOpen,
      readyCode: `${MESSAGE_TICKING_FEEDBACK_PREFIX}${TICKING_UARM_READY}`,
    });

    // this.serialPort.events.on('ready', () => {});
    this.serialPort.events.on('data', (data) => this.incoming(data));

    this.incoming = this.incoming.bind(this);
    return this;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.serialPort.open()
        .then(() => resolve())
        .catch(error => reject(error));
    });
  }

  /**
   * Write @param command to the serial port, prefixed with the Extended GCODE prefix
   * and a unique message id.
   * @param {string} command - The Robot command to be sent.
   * @param {Function} callback - To be called when data is received.
   */
  sendGCode(GCode, callback) {
    const newMsgId = this.messageId++;
    this.waitingResponses[newMsgId] = {
      timestamp: new Date().getTime(),
      callback,
      command: GCode,
    };
    const extendedGCode = `${MESSAGE_GCODE_SEND_PREFIX}${newMsgId} ${GCode}`;
    if (LOG_LEVEL > 10) {
      console.log(`Sending: ${extendedGCode}`);
    }
    this.serialPort.send(extendedGCode);
  }

  /**
   * Handler for incoming message. Will lookup the message id and call the callback
   * being referenced in that lookup. If lookup fails, an error will be thrown.
   * @param {string} data - Data received from the uArm, containing the message id.
   * @returns {nothing}
   */
  incoming(data) {
    if (LOG_LEVEL > 10) {
      console.log(`Incoming: <${data}>`);
    }
    const parts = /^(refer:|E|\$|@)(\d+)*\s+(.+)*/.exec(data);
    if (parts) {
      const {
        1: messageType,
        2: messageId,
        3: rest,
      } = parts;
      switch (messageType) {
        case MESSAGE_TICKING_FEEDBACK_PREFIX:
          console.log("UARM REPORTED: ", messageId, rest);
          break;
        case MESSAGE_ERROR_PREFIX: {
          const waiter = this.waitingResponses[messageId];
          const errorHandler = ERRORS[messageId];
          let error = errorHandler ?
            new Error(errorHandler) :
            new Error(`Unknown error [${MESSAGE_ERROR_PREFIX}${messageId}]: ${rest}`);
          waiter.callback(error);
          this.onError(new Error(errorHandler));

          break;
        }
        case MESSAGE_GCODE_RECEIVE_PREFIX: {
          const waiter = this.waitingResponses[messageId];
          if (!waiter) {
            throw new Error(`Unable to find message id: ${messageId}`);
          }
          waiter.callback(null, rest);
          this.waitingResponses[messageId] = null;
          break;
        }
        default:
          throw new Error(`Unknown messages type: ${messageType}`);
      }
    }
    else {
      console.error(`Got message NOT matching Regexp: ${data}`);
    }
  }

  /**
   * Get current position of the uArm.
   * @param {number} mode - The mode to be returned. Either CARTESIAN_MODE or POLAR_MODE.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getPosition(mode = CARTESIAN_MODE) {
    return new Promise((resolve, reject) => {
      this.sendGCode(mode === CARTESIAN_MODE ? 'P2220' : 'P2221', (error, data) => {
        if (error) {
          return reject(error);
        }
        if (!data.startsWith('ok')) {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        const regexp = mode === CARTESIAN_MODE ?
          new RegExp(/^ok\sX([-]*[0-9.]+)+\sY([-]*[0-9.]+)+\sZ([-]*[0-9.]+)+/) :
          new RegExp(/^ok\sS([-]*[0-9.]+)+\sR([-]*[0-9.]+)+\sH([-]*[0-9.]+)+/);
        const matches = regexp.exec(data);
        if (!matches) {
          return reject(`Unable to parse response: ${data}`);
        }
        let result = {};
        if (mode === CARTESIAN_MODE) {
          result.x = matches[1];
          result.y = matches[2];
          result.z = matches[3];
        } else {
          result.s = matches[1];
          result.r = matches[2];
          result.h = matches[3];
        }

        resolve(result);
      });
    });
  }

  /**
   * Get the current angle of joints.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getJointsAngle() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2200', (error, data) => {
        if (error) {
          return reject(error);
        }
        if (!data.startsWith('ok')) {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        const regexp = new RegExp(/^ok\sB([-]*[0-9.]+)+\sL([-]*[0-9.]+)+\sR([-]*[0-9.]+)+/);
        const matches = regexp.exec(data);
        if (!matches) {
          return reject(`Unable to parse response: ${data}`);
        }

        resolve({
          B: matches[1],
          L: matches[2],
          R: matches[3],
        });
      });
    });
  }

  /**
   * Get the device name of the uArm.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getDeviceName() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2201', (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Get current Hardware version for the uArm.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getHardwareVersion() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2202', (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Get current Software version for the uArm.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getSoftwareVersion() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2203', (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Get current API Version for the uArm.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getAPIVersion() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2204', (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Get current UID for the uArm.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getUid() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2205', (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Move to absolute Cartesian coordinates
   * @param {number} x - x in mm
   * @param {number} y - y in mm
   * @param {number} z - z in mm
   * @param {number} speed - Speed in mm/min
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  move(x, y, z, speed) {
    return new Promise((resolve, reject) => {
      const command = `G0 X${x.toFixed(4)} Y${y.toFixed(4)} Z${z.toFixed(4)} F${speed || this.defaultSpeed}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        if (data !== 'ok') {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        resolve();
      });
    });
  }

  /**
   * Move to absolute Polar coordinates
   * @param {number} stretch - Stretch in mm
   * @param {number} rotation - Rotation in degrees
   * @param {number} height - Height in mm
   * @param {number} speed - Speed in mm/min
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  movePolar(stretch, rotation, height, speed) {
    return new Promise((resolve, reject) => {
      const command = `G2201 S${stretch} R${rotation} H${height} F${speed || this.defaultSpeed}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Move the motor to the position
   * @param {number} jointID - The ID of joints (0-3).
   * @param {number} angle - The Angle to be set (0-180).
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  moveMotor(jointID, angle) {
    return new Promise((resolve, reject) => {
      this.sendGCode(`G2202 N${jointID} V${angle}`, (error, data) => {
        // TODO: Implement error handling on this level.
        // For uArm.moveMotor(1, 45) I am getting this as respons:
        // $X E21
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Set wrist angle
   * @param {number} angle - The Angle to be set (0-180).
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  setWrist(angle) {
    return new Promise((resolve, reject) => {
      this.sendGCode(`G2202 N${SERVO_HAND} V${angle}`, (error, data) => {
        if (error) {
          return reject(error);
        }
        // TODO: Implement error handling on this level.
        resolve(data);
      });
    });
  }

  /**
   * Move relative to current position
   * @param {number} x - x in mm
   * @param {number} y - y in mm
   * @param {number} z - z in mm
   * @param {number} speed - Speed in mm/min
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  moveRelative(x = 0, y = 0, z = 0, speed) {
    return new Promise((resolve, reject) => {
      const command = `G2204 X${x.toFixed(4)} Y${y.toFixed(4)} Z${z.toFixed(4)} F${speed || this.defaultSpeed}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        const parts = /^(ok|E)(\d+)*/.exec(data);
        if (!parts) {
          return reject(`Unable to parse data, got ${data}`);
        }
        if (parts[1] === 'E') {
          const errorCode = parts[2];
          return reject(ERRORS[errorCode] ? ERRORS[errorCode] : 'Unknown error');
        }
        resolve(data);
      });
    });
  }

  /**
   * Move relative to current position
   * @param {number} stretch - Stretch in mm
   * @param {number} rotation - Rotation in degrees
   * @param {number} height - Height in mm
   * @param {number} speed - Speed in mm/min
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  movePolarRelative(stretch, rotation, height, speed) {
    return new Promise((resolve, reject) => {
      const command = `G2205 S${stretch} R${rotation} H${height} F${speed || this.defaultSpeed}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }

  /**
   * Activate the buzzer on device
   * @param {number} frequence - The Frequence to beep at.
   * @param {number} delay - Time for sound in milliseconds
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  buzz(frequence = 1000, delay = 300) {
    return new Promise((resolve, reject) => {
      const command = `M2210 F${frequence} T${delay}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        if (data !== 'ok') {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        resolve();
      });
    });
  }

  /**
   * Turn the pump on/off.
   * @param {boolean} on - Wheter to turn gripper on or off.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  setPump(on) {
    return new Promise((resolve, reject) => {
      const command = `M2231 V${on ? 1 : 0}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        if (data !== 'ok') {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        resolve();
      });
    });
  }

  /**
   * Get current status of the pump (on / off).
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getPumpStatus() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2231', (error, data) => {
        if (error) {
          return reject(error);
        }
        if (!data.startsWith('ok')) {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        const regexp = new RegExp(/^ok\sV([01]+)/);
        const matches = regexp.exec(data);
        if (!matches) {
          return reject(`Unable to parse response: ${data}`);
        }
        resolve(matches[1] === "1" ? true : false);
      });
    });
  }

  /**
   * Turn the gripper on/off.
   * Will manually delay promise so device got time to close / open. We will
   * wait longer time while closing since we probably want to grip something.
   * Delay is adjustable by passing 'delay' param.
   * @param {boolean} on - Wheter to turn gripper on or off.
   * @param {number} delay - Delay in ms to wait befor resolving promise. The device
   * is responding "ok" as soon as operation has started.
   */
  setGripper(on, delay) {
    return new Promise((resolve, reject) => {
      const command = `M2232 V${on ? 1 : 0}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        if (data !== 'ok') {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        setTimeout(() => {
          resolve();
        }, delay || on ? 2500 : 1400);
      });
    });
  }

  /**
   * Get current status of the gripper (on / off).
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getGripperStatus() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2232', (error, data) => {
        if (error) {
          return reject(error);
        }
        if (!data.startsWith('ok')) {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        const regexp = new RegExp(/^ok\sV([01]+)/);
        const matches = regexp.exec(data);
        if (!matches) {
          return reject(`Unable to parse response: ${data}`);
        }
        resolve(matches[1] === "1" ? true : false);
      });
    });
  }

  /**
   * Get current mode.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getCurrentMode() {
    return new Promise((resolve, reject) => {
      this.sendGCode('P2400', (error, data) => {
        if (error) {
          return reject(error);
        }
        if (!data.startsWith('ok')) {
          return reject(`Didn't get "ok" as response, got ${data}`);
        }
        const regexp = new RegExp(/^ok\sV([0123]+)/);
        const matches = regexp.exec(data);
        if (!matches) {
          return reject(`Unable to parse response: ${data}`);
        }
        resolve(matches[1]);
      });
    });
  }

  /**
   * Put the uArm in delay mode.
   * @param {number} milliseconds - The amount of time to delay.
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  delay(milliseconds) {
    return new Promise((resolve, reject) => {
      const command = `G2004 P${milliseconds}`;
      this.sendGCode(command, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });
  }
}

module.exports = uArmSDK;
