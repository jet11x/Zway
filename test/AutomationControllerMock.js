AutomationController = function() {
    this.devices = new DevicesCollectionMock();
}

AutomationController.prototype.emit = function() {
    var type = arguments[0];
    this.debug("AutomationController.emit: ", arguments);
}

AutomationController.prototype.on = function() {
    this.debug("AutomationController.on: ", arguments);
}

AutomationController.prototype.off = function() {
    this.debug("AutomationController.off: ", arguments);
}

AutomationController.prototype.reset = function() {
    this.devices.reset();
}

AutomationController.prototype.add = function(id, title) {
    return this.devices.add(id, title);
}

/*AutomationController.prototype.get = function(devId) {
    this.debug("AutomationController.get", devId);
}*/

AutomationController.prototype.debug = function() {
    console.log(_.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
}

function DevicesCollectionMock() {
    this.vDevs = {};

    this.get = function(devId) {
        console.log("DevicesCollectionMock: get:" + devId);
        return this.vDevs[devId];
    }

    this.add = function(id, title) {
        var vDev = new VirtualDev(id, title);
        this.vDevs[id] = vDev;
        return vDev;
    }

    this.reset = function() {
        var self = this;
        _.keys(this.vDevs).forEach(function(dev) {
            self.vDevs[dev].reset();
        });
    }
}
/*
vDev.get("metrics:title")
 */
function VirtualDev(id, title) {
    self = this;
    this.id = id;
    this.metrics = {};
    this.metrics["metrics:title"] = title;

    this.performCommand = function(action) {
        console.log("VirtualDev.performCommand.  State " + this.state + "->" + action);
        this.state = action;
        this.lastAction = action;
        this.timesSetTo[action] = (this.timesSetTo[action] || 0) + 1;
    }

    this.reset = function() {
        this.timesSetTo = {"on": 0, "off": 0};
        this.state = "Unknown"
        this.lastAction = "";
    }

    this.reset();

    this.get = function(what) {
        return (what in this.metrics) ? this.metrics[what] : "";
    }
}