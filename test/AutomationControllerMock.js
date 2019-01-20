AutomationController = function(clock) {
    this.devices = new DevicesCollectionMock(clock);
    this.cron = new CronMock(this, clock);
    this.onName = {};
}

AutomationController.prototype.emit = function() {
    var type = arguments[0];
    // cron.addTask cron.removeTask
    switch(type) {
        case "cron.addTask": this.cron.add(arguments[1], arguments[2]); break;
        case "cron.removeTask": this.cron.remove(arguments[1]); break;
        //TODO:default:
            //throw "Don't understand emit " + type;
    }
    if (type === 'cron.addTask')
    this.debug("AutomationController.emit: ", arguments);
}

AutomationController.prototype.listCronEntries = function() {
    return this.cron.listEntries();
}

AutomationController.prototype.on = function(name, fn) {
    assert(!(name in this.onName),'Should not already have ' + name + ' for controller.on');
    this.onName[name] = fn;
    this.debug("AutomationController.on: ", arguments);
}

AutomationController.prototype.cronNotify = function(name) {
    this.onName[name]();
}

AutomationController.prototype.off = function(name) {
    delete this.onName[name];
    this.debug("AutomationController.off: ", arguments);
}

AutomationController.prototype.getOnKeys = function() {
    return Object.keys(this.onName);
};

AutomationController.prototype.reset = function() {
    this.devices.reset();
}

// Hide the devices to simulate init being called before all devices are setup
AutomationController.prototype.hide = function() {
    this.devices.hide();
}


AutomationController.prototype.unhide = function() {
    this.devices.unhide();
}

AutomationController.prototype.add = function(id, title, type) {
    return this.devices.add(id, title, type);
}

AutomationController.prototype.addNotification = function() {
}

AutomationController.prototype.debug = function() {
    //console.log(_.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
}



function CronMock(controller, clock) {
    this.clock = clock;
    this.controller = controller;
    this.sortedTimers = [];
    clock.setCron(this);

    this.add = function(name, time) {
        var self = this;
        // Check if we already have entry for this timer
        var dup = _.filter(self.sortedTimers, function(timer) {
            return timer.name === name &&
                timer.time.hours === time.hours &&
                timer.time.minutes === time.minutes;
        });
        if (dup.length > 0) {
            self.debug("add duplicate", name, time);
        } else {
            self.sortedTimers.push({
                "name": name,
                "when": self.clock.cronTime2Date(time),
                "time": time
            });
            self.sortedTimers = _.sortBy(self.sortedTimers, "when");
        }
        self.debug("add", name, time, self.sortedTimers);
    };

    this.remove = function(name) {
        var self = this;
        var lenBefore = self.sortedTimers.length;
        self.sortedTimers = _.reject(self.sortedTimers, function(timer) {return timer.name === name});
        if (lenBefore === self.sortedTimers.length) {
            self.debug("remove failed for ", name, self.sortedTimers);
        } else {
            self.debug("remove", name, self.sortedTimers);
        }
    };

    this.listEntries = function() {
        return _.reduce(this.sortedTimers, function(memo, value, index) {
            //console.log("value " + value + " " + index);
            memo.push([index, value]);
            return memo;
        }, []);
    };

    this.clockChange = function(now) {
        var self = this;
        var triggered = 0;
        // TODO: switch to partition?
        for(var i=0; i<self.sortedTimers.length; i++) {
            var timer = self.sortedTimers[i];
            if (timer.when > now) break;
            triggered++;
            self.debug("clockChange cronNotify", timer.name);
            self.controller.cronNotify(timer.name);
            timer.when = self.clock.cronTime2Date(timer.time);
        }
        if (triggered > 0) {
            self.sortedTimers = _.sortBy(self.sortedTimers, "when");
            self.debug("clockChange", "triggered", triggered, self.sortedTimers);
        }
    };

    this.debug = function() {
        debug("CronMock", arguments);
        debug("CronMock." +
            _.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
    };
}

function DevicesCollectionMock(clock) {
    this.vDevs = {};
    this.hidden = false;
    this.clock = clock;
    this.idCount = 0;

    this.debug = function() {
        console.log("DevicesCollectionMock." +
                    _.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
    };

    this.get = function(devId) {
        //console.log("DevicesCollectionMock: get:" + devId);
        return this.hidden ? null : this.vDevs[devId];
    };

    this.create = function(vDevIn) {
        this.idCount++;
        var id = '_' + this.idCount;
        var vDev = new VirtualDev(id, vDevIn.deviceId, vDevIn.overlay.deviceType);
        _.extend(vDev, vDevIn);
        _.forEach(_.keys(vDevIn.defaults.metrics), function(metric) {
            vDev.set('metrics:' + metric, vDevIn.defaults.metrics[metric]);
        });
        this.vDevs[id] = vDev;
        return vDev;
    };

    this.remove = function(id) {
        delete this.vDevs[id];
    };

    this.add = function(id, title, type) {
        var vDev = new VirtualDev(id, title, type);
        //vDev.collection = this;  //TODO: causes infinite loop when using stringify
        this.vDevs[id] = vDev;
        return vDev;
    }

    this.reset = function() {
        var self = this;
        _.keys(this.vDevs).forEach(function(dev) {
            self.vDevs[dev].reset();
        });
    }

    this.toJSON = function () {
        // Avoid circular dependency when using JSON.stringify
        return _.omit(this, [ "collection" ]);
    };

    this.hide = function() {
        this.hidden = true;
    }

    this.unhide = function() {
        this.hidden = false;
    };

    /*this.on = function() {
        this.debug('on', parameters);
    }*/
}

function VirtualDev(id, title, type) {
    self = this;
    this.id = id;
    this.origTitle = title;
    this.type = type;
    this.metrics = {};
    this.callbacks = {};
    this.order = {};

    this.performCommand = function(action, args) {
        var self = this;

        var onOff = action;
        debug("VirtualDev.performCommand.  id=" + id + " State " + this.state + "->" + action);
        if (action === 'exact') {
            if (typeof(args) === "object" && "level" in args) {
                onOff = args.level === 0 ? 'off' : 'on';
            }
        }
        self.state = onOff;
        self.lastAction = onOff;
        self.timesSetTo[onOff] = (self.timesSetTo[onOff] || 0) + 1;
        if (_.has(self, 'handler')) {
            self.handler(action, args);
        } else {
            if (action === 'on') {
                self.metrics["metrics:level"] = "on"; // TODO: need to support dimmer too
            } else if (action === 'off') {
                self.metrics["metrics:level"] = "off";
            } else if (action === 'exact') {
                self.metrics["metrics:level"] = args.level;
            } else {
                console.error("Oops don't know action " + action);
            }
        }
        //if (!!self.callbacks) self.callbacks.forEach(function(callback) {callback(self);});
        Object.keys(self.callbacks).forEach(function(key) {self.callbacks[key](self);});
    }

    this.reset = function() {
        this.timesSetTo = {"on": 0, "off": 0};
        this.state = "off";
        this.lastAction = "";
        this.metrics["metrics:title"] = this.origTitle;
        this.metrics["metrics:level"] = type === "switchBinary" ? "off" : 0;
    }

    this.reset();

    this.get = function(what) {
        if (what === 'deviceType') return this.type;
        return (what in this.metrics) ? this.metrics[what] : "";
    };

    this.setTmpTitle = function(title) {
        this.metrics["metrics:title"] = title;
    };

    this.on = function(eventName, func) {
        debug("VirtualDev.on  " + eventName);
        if (eventName === 'modify:metrics:level') {
            this.callbacks[func] = func;
        }
    };

    this.off = function(eventName, func) {
        debug("VirtualDev.off  id=" + this.id + ' title=' + this.origTitle + ' ' + eventName);
        if (eventName === 'modify:metrics:level') {
            delete this.callbacks[func];
        }
    };

    this.set = function(metric, value) {
        this.metrics[metric] = value;
    }
}