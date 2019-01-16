function MultiToBinary(id, controller) {
    // Call super-constructor first (AutomationModule)
    MultiToBinary.super_.call(this, id, controller);

    this.vDev = undefined;
}

inherits(MultiToBinary, BaseModule);

_module = MultiToBinary;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

MultiToBinary.prototype.init = function (config) {
    MultiToBinary.super_.prototype.init.call(this, config);
    var self = this;

    self.log("config:" + JSON.stringify(config));

    // Add delay before getting device value

    self.onLevel = config.onLevel;

    // Create vdev
    self.vDev = this.controller.devices.create({
        deviceId: "MultiToBinary_" + self.id,
        defaults: {
            metrics: {
                title: self.langFile.m_title,
            }
        },
        overlay: {
            metrics: {
                icon: "switch",
                level: "off" //TODO: change to get from device
            },
            probeType: 'controller_multi_to_binary',
            deviceType: 'switchBinary'
        },
        handler: function(command, args) {
            self.log("handler (" + command + ", " + JSON.stringify(args) + ")");
            if (command != 'update') {
                this.set("metrics:level", command);
                self.light.performCommand("exact", { level: command === "on" ? self.onLevel : 0 });
            }
        },
        moduleId: self.id
    });

    self.light = self.controller.devices.get(config.device);
    self.callbackLight = _.bind(self.handleLight, self);
    self.light.on('modify:metrics:level', self.callbackLight);  //TODO: add in with some sort of ignore

    var level = self.light.get("metrics:level");
    self.vDev.set('metrics:level', level === 0 ? 'off' : 'on');
};

MultiToBinary.prototype.stop = function () {
    var self = this;

    if (self.vDev) {
        //self.vDev.off('modify:metrics:level', self.callbackLight);
        self.controller.devices.remove(self.vDev.id);
        self.vDev = undefined;
    }

    if (self.light) {
        self.light.off('modify:metrics:level', self.callbackLight);
        this.callbackLight = undefined;
    }

    MultiToBinary.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

MultiToBinary.prototype.handleLight = function(vDev) {
    var self = this;

    var level   = vDev.get("metrics:level");

    self.log("handleLight level=" + level + " vDev:" + JSON.stringify(vDev));
    self.vDev.set("metrics:level", level > 0 ? 'on' : 'off');
};