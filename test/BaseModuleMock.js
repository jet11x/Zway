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
            "title": "LightTimetable"
        }
    }
    this.config = {};
};

BaseModule.prototype.init = function (config) {
    console.log("--- Starting module " + this.meta.defaults.title);
    /*if (!!config) {
        this.saveNewConfig(config);
    } else {
        this.loadConfig();
    }*/
    this.config = config;
};

BaseModule.prototype.stop = function() {

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