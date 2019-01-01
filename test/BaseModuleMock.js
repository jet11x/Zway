BaseModule = function (id, controller) {
    var self = this;

    this.id = id;
    this.controller = controller;
    /*this.meta = this.getMeta();

    this.actions = {};
    this.actionFuncs = {};
    this.metrics = {};*/
    this.metrics = [[],[]];

    this.meta = {
        "defaults": {
            "title": "moduleName"
        }
    }
    this.config = {};
};

BaseModule.prototype.init = function (config) {
    console.log("--- Starting module " + this.meta.defaults.title);
    this.config = config;
};

BaseModule.prototype.stop = function() {

}

BaseModule.prototype.now = function() {
    return new Date();
}

BaseModule.prototype.log = function(message) {
    if (undefined === message) return;
    console.log('['+this.constructor.name+'-'+this.id+'] '+message);
}

BaseModule.prototype.error = function(message) {
    if (undefined === message) message = 'An unknown error occured';
    var error = new Error(message);
    console.error('['+this.constructor.name+'_'+this.id+'] '+error.stack);
};

BaseModule.prototype.getDeviceValue = function(criteria,key) {
    return this.metrics[criteria.join(""),key]
}

BaseModule.prototype.getPresenceMode = function() {
    var self = this;

    var value = self.getDeviceValue([
        ['probeType','=','presence']
    ],'metrics:mode');

    if (typeof(value) === 'undefined') {
        self.error('Could not find presence device');
        return 'home'; // Fallback
    }

    return value;
};

BaseModule.prototype.processDeviceList = function(devices,callback) {
    var self = this;
    if (! _.isFunction(callback)) {
        self.error('Invalid callback for processDeviceList');
        return;
    }

    if (_.isUndefined(devices) === 'undefined') {
        return;
    } else if (! _.isArray(devices)) {
        devices = [ devices ];
    }

    _.each(devices,function(device) {
        var vDev;
        if (_.isString(device)) {
            vDev = self.controller.devices.get(device);

        } else if (_.isObject(device)) {
            vDev = device;
        }
        if (_.isNull(vDev) || _.isUndefined(vDev)) {
            self.error('Device not found '+device);
            return;
        }
        callback(vDev);
    });
};


// From Automation Module
BaseModule.prototype.getName = function() {
    return /(\w+)\(/.exec(this.constructor.toString())[1];
};

BaseModule.prototype.addNotification = function (severity, message, type) {
    this.controller.addNotification(severity, message, type, this.getName());
};