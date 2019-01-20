/*** DummyDevice Z-Way HA module *******************************************

Version: 1.1.0
(c) Z-Wave.Me, 2017
-----------------------------------------------------------------------------
Author: Poltorak Serguei <ps@z-wave.me>, Ray Glendenning <ray.glendenning@gmail.com>
Description:
    Creates a Dummy device
******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function DummyDeviceExtra (id, controller) {
    // Call superconstructor first (AutomationModule)
    DummyDeviceExtra.super_.call(this, id, controller);
}

inherits(DummyDeviceExtra, AutomationModule);

_module = DummyDeviceExtra;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

DummyDeviceExtra.prototype.init = function (config) {
    DummyDeviceExtra.super_.prototype.init.call(this, config);

    var self = this,
        icon = "",
        level = "",
        deviceType = this.config.deviceType;

    var switchType = deviceType == "sensorBinary" ? "switchBinary" : deviceType;
    var extraTitle = deviceType == "sensorBinary" ? " Switch" : "";
    var extraId = deviceType == "sensorBinary" ? "_sw_" :  "";

    this.vDevSensor = null;
        
    switch(switchType) {
        case "switchBinary":
            icon = "switch";
            level = "off";
            break;
        case "switchMultilevel":
            icon = "multilevel";
            level = 0;
            break;
    }
    
    var defaults = {
        metrics: {
            title: self.getInstanceTitle()  + extraTitle
        }
    };
 
    var overlay = {
            deviceType: switchType,
            metrics: {
                icon: icon,
                level: level
            }      
    };

    this.vDev = this.controller.devices.create({
        deviceId: "DummyDeviceExtra_" + extraId + this.id,
        defaults: defaults,
        overlay: overlay,
        handler: function(command, args) {
            
            if (command != 'update') {
                var level = command;
                
                if (this.get('deviceType') === "switchMultilevel") {
                    if (command === "on") {
                        level = 99;
                    } else if (command === "off") {
                        level = 0;
                    } else {
                        level = args.level;
                    }
                }

                this.set("metrics:level", level);
                if (self.vDevSensor) {
                    self.vDevSensor.set("metrics:level", command);
                }
            }
        },
        moduleId: this.id
    });

    if (deviceType == 'sensorBinary') {
        this.vDevSensor = this.controller.devices.create({
            deviceId: "DummyDeviceExtra_" + this.id,
            defaults: {
                metrics: {
                    title: self.getInstanceTitle()
                }
            },
            overlay: {
                deviceType: deviceType,
                metrics: {
                    icon: "sensor",
                    level: 'off'
                }
            },
            moduleId: this.id
        });
    }
};

DummyDeviceExtra.prototype.stop = function () {
    if (this.vDev) {
        this.controller.devices.remove(this.vDev.id);
        this.vDev = null;
    }

    if (this.vDevSensor) {
        this.controller.devices.remove(this.vDevSensor.id);
        this.vDevSensor = null;
    }

    DummyDeviceExtra.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------