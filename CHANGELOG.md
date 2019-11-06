
# 1.0.0

* Added new methods: setWrist() and getCurrentMode()
* Since the uArm will report "ok" right away when closing/opening the gripper and optional delay has been added before the setGripper will resolve.
* Support for setting default speed in constructor (you can still adjust this for each separate move command to the uArm).
* Command callbacks is now being called with potential error as first argument.
* Better error handling for: getDeviceName, getHardwareVersion, getSoftwareVersion, getAPIVersion, getUid, move, movePolar, moveMotor, moveRelative, movePolarRelative, buzz, setPump, getPumpStatus, setGripper, getGripperStatus, delay

## Breaking changes

* `sendCommand` has been renamed to `sendGCode`
* The callback for each command is now written with error first pattern `(error, data) => {}`(previously calling onError method passed into constructor with the error without possibility to track to specific commands).
# 0.1.5

Added example code in READM.md.

# 0.1.4

Initial version with basic commands and able to
