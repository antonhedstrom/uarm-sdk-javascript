const SerialCommunication = require('../comm/serial-comm');
const {
  LOG_LEVEL,
  MESSAGE_TICKING_FEEDBACK_PREFIX,
  TICKING_UARM_READY,
  MESSAGE_GCODE_SEND_PREFIX,
  MESSAGE_GCODE_RECEIVE_PREFIX,
  SPEED_DEFAULT,
  RECEIVE_REGEXP,
  MESSAGE_ERROR_PREFIX,
  CARTESIAN_MODE,
} = require('./constants');

const ERRORS = require('./errors');

class uArmSDK {
  constructor({ port, onError, autoOpen = true }) {
    this.messageId = 1; // Bump by one for every message.
    this.waitingResponses = {}; // Object containing all unresponded messages.

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
   * Write @param command to the serial port, prefixed with the GCODE prefix
   * and a unique message id.
   * @param {string} command - The Robot command to be sent.
   * @param {Function} callback - To be called when data is received.
   */
  sendCommand(command, callback) {
    const newMsgId = this.messageId++;
    this.waitingResponses[newMsgId] = {
      timestamp: new Date().getTime(),
      callback,
      command,
    };
    const GCODE = `${MESSAGE_GCODE_SEND_PREFIX}${newMsgId} ${command}`;
    if (LOG_LEVEL > 0) {
      console.log(`Sending: ${GCODE}`);
    }
    this.serialPort.send(GCODE);
  }

  /**
   * Handler for incoming message. Will lookup the message id and call the callback
   * being referenced in that lookup. If lookup fails, an error will be thrown.
   * @param {string} data - Data received from the uArm, containing the message id.
   * @returns {nothing}
   */
  incoming(data) {
    if (LOG_LEVEL > 0) {
      console.log(`Got: ${data}`);
    }
    const parts = RECEIVE_REGEXP.exec(data);
    if (parts) {
      const {
        1: messageType,
        2: messageId,
        3: rest,
      } = parts;
      console.log("TYPE", messageType, MESSAGE_ERROR_PREFIX);
      switch (messageType) {
        case MESSAGE_TICKING_FEEDBACK_PREFIX:
          console.log("UARM REPORTED: ", messageId, rest);
          break;
        case MESSAGE_ERROR_PREFIX: {
          console.log("ERRORRRR", messageId);
          const errorHandler = ERRORS[messageId];
          if (errorHandler) {
            this.onError(new Error(errorHandler));
          } else {
            this.onError(new Error(`Unknown error [${MESSAGE_ERROR_PREFIX}${messageId}]: ${rest}`));
          }
          break;
        }
        case MESSAGE_GCODE_RECEIVE_PREFIX: {
          const waiter = this.waitingResponses[messageId];
          if (!waiter) {
            throw new Error(`Unable to find message id: ${messageId}`);
          }
          waiter.callback(rest);
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
      this.sendCommand(mode === CARTESIAN_MODE ? 'P2220' : 'P2221', (data) => {
        if (!data.startsWith('ok')) {
          reject('Didn\'t get "ok" as response');
        }
        const regexp = mode === CARTESIAN_MODE ?
          new RegExp(/^ok\sX([-]*[0-9.]+)+\sY([-]*[0-9.]+)+\sZ([-]*[0-9.]+)+/) :
          new RegExp(/^ok\sS([-]*[0-9.]+)+\sR([-]*[0-9.]+)+\sH([-]*[0-9.]+)+/);
        const matches = regexp.exec(data);
        if (!matches) {
          reject(`Unable to parse response: ${data}`);
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
      this.sendCommand('P2200', (data) => {
        if (!data.startsWith('ok')) {
          reject('Didn\'t get "ok" as response');
        }
        const regexp = new RegExp(/^ok\sB([-]*[0-9.]+)+\sL([-]*[0-9.]+)+\sR([-]*[0-9.]+)+/);
        const matches = regexp.exec(data);
        if (!matches) {
          reject(`Unable to parse response: ${data}`);
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
      this.sendCommand('P2201', (data) => {
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
      this.sendCommand('P2202', (data) => {
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
      this.sendCommand('P2203', (data) => {
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
      this.sendCommand('P2204', (data) => {
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
      this.sendCommand('P2205', (data) => {
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
  move(x, y, z, speed = SPEED_DEFAULT) {
    return new Promise((resolve, reject) => {
      const command = `G0 X${x} Y${y} Z${z} F${speed}`;
      this.sendCommand(command, (data) => {
        if (data !== 'ok') {
          return reject('Didn\'t get "ok" as response');
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
  movePolar(stretch, rotation, height, speed = SPEED_DEFAULT) {
    return new Promise((resolve, reject) => {
      const command = `G2201 S${stretch} R${rotation} H${height} F${speed}`;
      this.sendCommand(command, (data) => {
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
      const command = `G2202 N${jointID} V${angle}`;
      this.sendCommand(command, (data) => {
        // TODO: Implement error handling on this level.
        // For uArm.moveMotor(1, 45) I am getting this as respons:
        // $X E21
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
  moveRelative(x = 0, y = 0, z = 0, speed = SPEED_DEFAULT) {
    return new Promise((resolve, reject) => {
      const command = `G2204 X${x} Y${y} Z${z} F${speed}`;
      this.sendCommand(command, (data) => {
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
  movePolarRelative(stretch, rotation, height, speed = SPEED_DEFAULT) {
    return new Promise((resolve, reject) => {
      const command = `G2205 S${stretch} R${rotation} H${height} F${speed}`;
      this.sendCommand(command, (data) => {
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
      this.sendCommand(command, (data) => {
        if (data !== 'ok') {
          return reject('Didn\'t get "ok" as response');
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
      this.sendCommand(command, (data) => {
        if (data !== 'ok') {
          return reject('Didn\'t get "ok" as response');
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
      this.sendCommand('P2231', (data) => {
        resolve(data);
      });
    });
  }

  /**
   * Turn the gripper on/off.
   * @param {boolean} on - Wheter to turn gripper on or off.
   */
  setGripper(on) {
    return new Promise((resolve, reject) => {
      const command = `M2232 V${on ? 1 : 0}`;
      this.sendCommand(command, (data) => {
        if (data !== 'ok') {
          return reject('Didn\'t get "ok" as response');
        }
        resolve();
      });
    });
  }

  /**
   * Get current status of the gripper (on / off).
   * @returns {Promise} - A promise that will be resolved when uArm respond.
   */
  getGripperStatus() {
    return new Promise((resolve, reject) => {
      this.sendCommand('P2232', (data) => {
        resolve(data);
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
      this.sendCommand(command, (data) => {
        resolve(data);
      });
    });
  }
}

module.exports = uArmSDK;
