const SerialPort = require('serialport');

function findPort({ acceptFn }) {
  return new Promise((resolve, reject) => {
    if (!acceptFn || typeof acceptFn !== 'function') {
      return reject('Argument acceptFn is either missing or is not a function.');
    }
    SerialPort.list().then((ports) => {
      const uarmPort = ports.find((port) => {
        if (acceptFn(port)) {
          console.log(`💪  Found UARM serialport: ${port.comName}`);
          return port;
        }
      });

      if (!uarmPort) {
        return reject(`😔  No Acceptable Port Found:\n${ports.map((port) => `${port.comName}\n`)}`);
      }
      resolve(uarmPort);
    }).catch(err => reject(err));
  });
}

module.exports = findPort;
