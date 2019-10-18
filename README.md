# uArm Javascript SDK

This is a Javascript SDK to be used for communicating with your [uArm Robot arm](https://www.ufactory.cc/#/en/uarmswift) from [uFactory.cc](https://www.ufactory.cc).

# Example usage

The package offer a method to find the correct serial port to communicate over. If you already know your serial port path, feel free to use the SDK right away. The example below shows an example implementation when the `findPort` method is being used to find the correct serial port path.

```js
const { uArmSDK, findPort } = require('uarm-sdk-javascript');

const regexp = new RegExp(/Arduino/i);
const acceptPortFn = (port) => regexp.test(port.manufacturer);

findPort(acceptPortFn).then(port => {
  const uarm = new uArmSDK({
    port,
    autoOpen: false,
    onError: (error) => {
      console.log("uArm Error: ", error);
    },
  });

  uarm.open().then(async () => {
    const position = await uarm.getPosition();
    console.log("uArm current position is: ", position);
  });
});

```

Current, there is not documention for the available methods in the SDK. The easiest way is to look in the source code (`./uarm/sdk.js`).
