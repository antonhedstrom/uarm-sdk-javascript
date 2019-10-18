
const uArmSDK = require('./uarm/sdk');
const findPort = require('./comm/find-port');

const portRegexp = /Arduino/i;

module.exports = {
  uArmSDK,
  findPort: (acceptFn) => {
    if (!acceptFn) {
      acceptFn = (port) => portRegexp.test(port.manufacturer);
    }
    return findPort({ acceptFn });
  },
};
