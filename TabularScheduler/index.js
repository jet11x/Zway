/*** TabularScheduler Z-Way HA module *******************************************

 Version: 0.0.5
 (c) John Talintyre, 2017-19
 -----------------------------------------------------------------------------
 -----------------------------------------------------------------------------
 Author: John Talintyre

 Description: Schedule several lights with a table where each entry defines.
   - Presence (home, away etc)
   - Randomisation (yes/no)
   - Days to run
   - Start and end time
   - A light

 In addition:
   - Specify active hours - lights can't be on outside this.  Defined based on time or sunrise/sunset
   - Give sensors to control some or all of the lights

 Uses BaseModule, Presence and Astronomy by Maroš Kollár <maros@k-1.com>
 Also takes ideas/code from his MotionTrigger module, see https://github.com/maros/Zway-MotionTrigger
 ******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function TabularScheduler(id, controller) {
    // Call super-constructor first (AutomationModule)
    TabularScheduler.super_.call(this, id, controller);

    this.callbackPresence = undefined;
    this.callbackSensor = undefined;
    this.callbackLight = undefined;

    this.sensors = undefined;
    this.lights = undefined;
    this.schedule = undefined;
    this.scheduled = undefined;
    this.activeHours = undefined;

    this.vDev = undefined;
}

inherits(TabularScheduler, BaseModule);

_module = TabularScheduler;

/*
TODO: adjust times due to change when activeHours change.  Consider incorporating astronomy code to avoid need for this
TODO: define polling interval
TODO: make sure timeout for sensors not messed up by a re-start
TODO: ensure timeouts cleared down

How start/end are triggered
  Check the times against recorded times in self.scheduled
     note per entry/switch when each start time is triggered
     when end time has triggered for an entry/switch then reschedule if needed
TODO: improve this description

How security sensor works
   If any light is on then no effect
   If no light on and in active period
       Switch on all lights
       Set timeout
   If light triggered on then reset timeout
 */

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

TabularScheduler.prototype.init = function (config) {
    // noinspection JSPotentiallyInvalidConstructorUsage
    TabularScheduler.super_.prototype.init.call(this, config);
    var self = this;

    // Create vdev
    self.vDev = this.controller.devices.create({
        deviceId: "TabularScheduler_" + self.id,
        defaults: {
            metrics: {
                level: 'off',
                sensorsTriggered: false,
                onBySchedule: 0,
                title: self.langFile.m_title,
                icon: self.imagePath + '/icon-out-of-hours.png'
            }
        },
        overlay: {
            probeType: 'controller_tabularScheduler',
            deviceType: 'sensorBinary'
        },
        doUpdateNum: function(metric, increment) {
            var num = this.get('metrics:' + metric);
            this.doUpdate(metric, num);
        },
        doUpdate: function(metric , value) {
            this.set('metrics:'+metric, value);
            if(this.get("metrics:level") === 'off') {
                this.set('metrics:icon', self.imagePath + '/icon-out-of-hours.png');
            } else if (this.get('metrics:sensorsTriggered')) {
                this.set("metrics:icon", self.imagePath + '/icon-lights-on-by-sensor.png');
            } else if (this.get('metrics:onBySchedule') > 0) {
                this.set('metrics:icon', self.imagePath + '/icon-lights-on.png');
            } else {
                this.set('metrics:icon', self.imagePath + '/icon-active-hours.png')
            }
            self.debug("vDev.doUpdate(metric={},value={} vDev:{:S}", metric, value, this);
        },
        moduleId: self.id
    });

    self.fmt = new TabularFormat();

    self.debug("init {:=S}", config);

    self.getDev = function (devId) {
        var self = this;
        return self.controller.devices.get(devId);
    };

    if (!self.rerunableInit(true)) {
        var wait = 12;
        self.info("init: devices not all initialised when starting. Wait for {}secs", wait);
        // Wait to do rest of initialization to ensure devices are setup and so can refer to their names
        setTimeout(_.bind(self.rerunableInit, self, false), wait*1000);
    }
};

TabularScheduler.prototype.rerunableInit = function(firstRun) {
    var self = this;

    self.debug("rerunableInit(firstRun={}) config={}}", self.config);

    if (firstRun) {
        self.lights = {
            byDevice: {},
            numLights: 0,
            changeLights: function (lights, event, source) {
                // Returns number turned on
                return _.reduce(lights, function (numTurnedOn, light) {
                    numTurnedOn += light.changeLight(event, source) == 'turnedOn' ? 1 : 0;
                    return numTurnedOn;
                }, 0);
            },
            addOrGet: function (device) {
                if (device in this.byDevice) {
                    return this.byDevice[device];
                }
                var vDev = self.getDev(device);
                var light = new TabularLight(device, ++this.numLights, vDev, self);
                light.setOnStatus(vDev);
                this.byDevice[device] = light;
                return light;
            }
        }
    } else {
        self.lights.byDevice = {};
    }

    // Create base configuration for timetable entries and their switches/lights
    var schedule = [];
    for (var i=0; i<self.config.timetable.length; i++) {
        var timetableRow = self.config.timetable[i];
        self.debug("Init for timetable entry #{}", i+1);
        var device = timetableRow.device;
        if (!self.getDev(device)) {
            if (firstRun) {
                self.lights.byDevice = undefined;
                self.lights.numLights = 0;
                return false;
            } else {
                self.error("Missing details of vDev for device " + device + " on init even after waiting with a timeout");
            }
        }

        var scheduleEntry = {
            light: self.lights.addOrGet(device),
            presence: timetableRow.presence,
            days: self.getDays(timetableRow.days),
            startTime: timetableRow.startTime,
            endTime: timetableRow.endTime,
            maxRandMs: timetableRow.randomise === 'yes' ? Math.round(self.config.maxRand*60*1000) : 0,
            num: schedule.length + 1
        };
        self.debug("init: added schedule entry {:S}", scheduleEntry);
        schedule.push(scheduleEntry);

    }
    self.schedule = schedule;

    self.lastPresence = self.getPresenceModeIgnoreNight();
    self.callbackPresence = _.bind(self.handlePresence, self);
    self.callbackSensor = _.bind(self.handleSensor,self);
    self.callbackLight = _.bind(self.handleLight, self);

    if (self.config.sensorTrigger.set) {
        var sensorLights = [];
        for(var i=0; i<self.config.sensorTrigger.switches.length; i++) {
            var device = self.config.sensorTrigger.switches[i];
            if (!self.getDev(device)) {
                if (firstRun) {
                    self.lights.byDevice = undefined;
                    self.lights.numLights = 0;
                    return false;
                } else {
                    self.error("Missing details of vDev for device " + device + " on init even after waiting with a timeout");
                }
            }
            sensorLights.push(self.lights.addOrGet(device));
        }
        self.sensors = {
            "timeoutMillis": Math.round(60*1000*self.config.sensorTrigger.timeout),
            "triggered": false,
            "lights": sensorLights
        };

        self.processDeviceList(self.config.sensorTrigger.sensors, function (vDev) {
            self.debug1("initCallback securitySensors callbackSensor(deviceObject)", vDev);
            vDev.on('modify:metrics:level', self.callbackSensor);
        });
    }

    // Setup event listeners
    _.each(self.presenceModes, function (presenceMode) {
        self.debug("About to call controller.on(presenceMode={})", presenceMode);
        self.controller.on("presence." + presenceMode, self.callbackPresence);
    });
    if (self.config.activeHours.set) {
        self.activeHours = self.getActiveHours();
        self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
    } else {
        self.activeHours = undefined;
    }
    var now = self.now();
    if (self.activeHours === undefined || (now >= self.activeHours.start && now <= self.activeHours.end)) {
        self.vDev.doUpdate('level', 'on');
    }
    self.scheduled = self.calculateSchedule();

    self.processDeviceList(_.map(self.lights.byDevice, function(light) { return light.getDev(); }), function (vDev) {
            self.debug1("initCallback lights callbackLight(deviceObject.on", vDev.id, ")");
            vDev.on('modify:metrics:level', self.callbackLight);
    });

    self.eventTimes = self.getEventTimes();

    self.checkEventsId = setInterval(_.bind(self.checkEvents, self, false), 60*1000);

    return true;
};

TabularScheduler.prototype.stop = function () {
    var self = this;

    self.debug1("stop entered");
    if (!self.schedule) return;

    clearInterval(self.checkEventsId);

    self.processDeviceList(_.map(self.lights.byDevice, function(light) { return light.getDev(); }), function (vDev) {
        vDev.off('modify:metrics:level', self.callbackLight);
    });

    if (self.config.sensorTrigger.set) {
        self.processDeviceList(self.config.sensorTrigger.sensors, function (vDev) {
            vDev.off('modify:metrics:level', self.callbackSensor);
        });
    }

    _.each(self.presenceModes, function (presenceMode) {
        self.controller.off("presence." + presenceMode, self.callbackPresence);
    });

    this.callbackPresence = undefined;
    this.callbackSensor = undefined;
    this.callbackLight = undefined;

    if (self.vDev) {
        self.controller.devices.remove(self.vDev.id);
        self.vDev = undefined;
    }

    // noinspection JSPotentiallyInvalidConstructorUsage
    TabularScheduler.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

TabularScheduler.prototype.checkEvents = function() {
    var self = this;

    var now = self.now();
    if (!!self.activeHours) {
        if (self.vDev.get('metrics:level') === 'off') {
            //self.debug("checkEvents not in active hours which are {start:Dt}->{end:Dt}", self.activeHours);
            if (self.activeHours.start <= now) self.handleActiveHoursStart();
        } else {
            if (self.activeHours.end <= now) self.handleActiveHoursEnd();
        }
    }

    if (self.eventTimes.length > 0 && self.eventTimes[0].time <= now) {
        var partitions = _.partition(self.eventTimes, function(eventTime) { return eventTime.time <= now; });
        var futureEvents = partitions[1];
        var rescheduled = [];
        partitions[0].forEach(function(eventTime) {
            var event = eventTime.event;
            var scheduled = eventTime.scheduledEntry;
            var light = scheduled.scheduledLight.light;
            self.debug("checkEvents: {event:=} {scheduledEntry:=S})", eventTime);
            switch(event) {
                case 'start':
                case 'end':
                    light.changeLight(event, "schedule");
                    scheduled.scheduledLight[event] = null; // Don't repeat event
                    break;
                case 'reschedule':
                    scheduled.scheduledLight =
                        self.calculateScheduledLight(scheduled.entry, light, true, self.activeHours);
                    rescheduled.push(self.getEventTimesForEntry(scheduled));
                    break;
            }
        });
        self.eventTimes = _.sortBy(_.union(futureEvents, _.flatten(rescheduled)), 'time');
    }
};

TabularScheduler.prototype.getEventTimesForEntry = function(scheduledEntry) {
    var events = [];
    ['start','end','reschedule'].forEach(function(event) {
        if (scheduledEntry.scheduledLight[event] != null) {
            events.push({
                'scheduledEntry': scheduledEntry,
                'event': event,
                'time': scheduledEntry.scheduledLight[event]
            });
        }
    });
    return events;
}

TabularScheduler.prototype.getEventTimes = function() {
    var self = this;
    return _.sortBy(
            _.reduce(self.scheduled, function(events, scheduledEntry) {
                return scheduledEntry.active ? _.union(events, self.getEventTimesForEntry(scheduledEntry)) : events;
            }, []),
'time');
};

TabularScheduler.prototype.getDays = function(daysStrings) {
    return _.map(
            _.reduce(daysStrings, function(memo, daysString) {
            return _.union(memo, daysString.split(','));
            }, []),
        function(num) {return parseInt(num)});
}

TabularScheduler.prototype.handlePresence = function () {
    var self = this;

    var newPresence = self.getPresenceModeIgnoreNight();

    if (self.lastPresence !== newPresence) {
        self.summary("Presence change: {} -> {}", self.lastPresence, newPresence);

        self.lastPresence = newPresence;
        self.scheduled = self.calculateSchedule();
        self.eventTimes = self.getEventTimes();
    } else {
        self.debug("Presence change event but no change in presence stays as {}", self.lastPresence);
    }
};

TabularScheduler.prototype.handleLight = function(vDev) {
    this.lights.byDevice[vDev.id].setOnStatus(vDev);
};

TabularScheduler.prototype.getPresenceModeIgnoreNight = function() {
    var self = this;
    var presence = self.getPresenceMode();
    // Treat home and night (night at home) as the same
    return presence === 'night' ? 'home' : presence;
};

TabularScheduler.prototype.calculateSchedule = function () {
    var self = this;

    var scheduled = [];
    // Get the scheduled information
    self.summary("Calculating schedule for presence {}", self.lastPresence);
    self.schedule.forEach(function (scheduleEntry) {
        var active = scheduleEntry.presence === "any" || scheduleEntry.presence === self.lastPresence ||
            (scheduleEntry.presence === "away" && self.lastPresence === "vacation");
        var scheduledEntry = {
            entry: scheduleEntry,
            active: active,
            days: scheduleEntry.days, // TODO: needed?
            scheduledLight: self.calculateScheduledLight(scheduleEntry, scheduleEntry.light, active, self.activeHours)
        };
        scheduled.push(scheduledEntry);
    });
    self.debug("   Scheduled: {:S}", scheduled);
    self.info("Calculate schedule completed for {} entries", scheduled.length);

    return scheduled;
};

// Restricted active hours e.g. sunset to sunrise
TabularScheduler.prototype.calcTimesWithinActiveHours = function(now, activeHours, period) {
    var self = this;

    var newPeriod = {"start": period.start, "end": period.end};
    var which = period.start > activeHours.end ? 'next' : '';
    if (period.end < activeHours[which + 'start'] || period.start > activeHours[which + 'end']) {
        newPeriod.start = null;
    } else {
        newPeriod.start = period.start < activeHours[which + 'start'] ? activeHours[which + 'start'] : period.start;
        newPeriod.end = period.end > activeHours[which + 'end'] ? activeHours[which + 'end'] : period.end;
    }

    self.debug("calcTimesWithinActiveHours(now={}, activeHours={:S}, period={:S}) -> {}",
        now, activeHours, period, newPeriod);
    return newPeriod;
};

TabularScheduler.prototype.calculateScheduledLight = function (scheduleEntry, light, active, activeHours) {
    var self = this;
    var scheduledLight = {
        light: light,
        start: null,
        end: null,
        origstart: null,
        origend: null,
        reschedule: null,
        randstart: 0,
        randend: 0
    };

    if (!active) {
        return scheduledLight;
    }

    var period = {};
    var now = self.now();

    ["start", "end"].forEach(function (event) {
        period[event] = self.getEventTime('time', scheduleEntry[event + 'Time']);
        scheduledLight['rand' + event] = _.random(scheduleEntry.maxRandMs) * (event==='end' ? -1 : 1);
    });
    var start = period.start;
    if (period.end <= now) {
        period.end = self.moveTime(period.end, 24);
        if (period.start <= now) period.start = self.moveTime(period.start, 24);
    }
    scheduledLight.origstart = new Date(start < scheduledLight.origend ? start : period.start);
    scheduledLight.origend = new Date(period.end);
    scheduledLight.reschedule = new Date(period.end);

    // TODO: below looks a bit overcomplicated
    if (activeHours !== undefined) {
        period = self.calcTimesWithinActiveHours(now, activeHours, period);
    }

    scheduledLight.start = period.start;
    scheduledLight.end = period.end;

    ['start','end'].forEach(function(event) {
        if (scheduledLight[event] != null)
           scheduledLight[event].setTime(scheduledLight[event].getTime() + scheduledLight['rand' + event]);});

    self.debug("scheduleEntry.days={:S}", scheduleEntry.days);
    self.debug("scheduledLight {:S}", scheduledLight);
    self.debug(".getDay() -> {}", scheduledLight.origstart.getDay());
    var validStartDay = _.contains(scheduleEntry.days,scheduledLight.origstart.getDay());
    if (!validStartDay) scheduledLight.end = null;

    if (scheduledLight.start != null &&
        (   scheduledLight.start >= scheduledLight.end ||
            scheduledLight.start < now ||
            !validStartDay)) scheduledLight.start = null;

    self.info("   scheduled light: {}, start suspended: {}, triggered: {}", light.getRef(), scheduledLight.startSuspended,
        scheduledLight.triggered);
    self.debug("   scheduled light {:S}", scheduledLight);

    if (scheduledLight.end !== null) {
        self.summary("   Scheduling entry #{} '{}' {:Dt}->{:Dt} to {:Dt}->{:Dt}", scheduleEntry.num, light.getRef(),
            scheduledLight.origstart, scheduledLight.start, scheduledLight.origend, scheduledLight.end);
    } else {
        self.summary("   Entry #{} will re-schedule '{}' at {:Dt}", scheduleEntry.num, light.getRef(),
            scheduledLight.reschedule);
    }

    return scheduledLight;
};

TabularScheduler.prototype.now = function () {
    return new Date(); // Can be overridden for testing
};

TabularScheduler.prototype.getActiveHours = function() {
    var self = this;

    var activeHoursCfg = self.config.activeHours;
    var activeHours = {
        // TODO: Change way of getting sunrise and sunset
        "start": self.getEventTime(activeHoursCfg.startType, activeHoursCfg.startTime),
        "end": self.getEventTime(activeHoursCfg.endType, activeHoursCfg.endTime)
    };

    // TODO: could a few secs difference break this?
    if (activeHours.end <= self.now()) {
        activeHours.end = self.moveTime(activeHours.end, 24);
    }
    if (activeHours.start > activeHours.end) {
        activeHours.start = self.moveTime(activeHours.start, -24);
    }

    activeHours.nextstart = self.moveTime(activeHours.start, 24);
    activeHours.nextend = self.moveTime(activeHours.end, 24);

    self.debug("getActiveHours returns {start:Dt}->{end:Dt}", activeHours);
    return activeHours;
};



TabularScheduler.prototype.getEventTime = function (type, timeAdjust) {
    var self = this;

    if (!timeAdjust) timeAdjust = "00:00";

    var timeAdjustArr = timeAdjust.split(":");
    var hours = timeAdjustArr[0];
    var mins = timeAdjustArr[1];
    var timeAdj = hours * 60 * 60 * 1000 + mins * 60 * 1000;
    var now = self.now();
    var time = new Date(now.getTime());
    self.debug1("getEventTime type " + type + " timeAdjust " + timeAdjust + " now=", now);
    switch (type) {
        case "time":
            time.setHours(hours, mins);
            break;
        case "sunset":
            time.setTime(self.getSunset());
            break;
        case "sunsetPlus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunsetMinus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() - timeAdj);
            break;
        case "sunrise":
            time.setTime(self.getSunrise);
            break;
        case "sunrisePlus":
            time.setTime(self.getSunrise());
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunriseMinus":
            time.setTime(self.getSunrise());
            time.setTime(time.getTime() - timeAdj);
            break;
        default:
            self.error("Unknown time type: " + type);
            break;

    }

    time.setSeconds(0,0); // Cron module only goes down to minutes
    self.debug1("getEventTime exit", time);
    return time;
};

TabularScheduler.prototype.moveTime = function(time, hours) {
    var self = this;

    var movedTime = new Date(time.getTime());
    var toHour   = time.getHours();
    var toMinute = time.getMinutes();
    movedTime.setHours(toHour + hours);
    // Correct for DST
    movedTime.setHours(toHour, toMinute);
    self.debug1("moveTime  from", time, "to", movedTime);
    return movedTime;
};

TabularScheduler.prototype.getSunset = function () {
    var self = this;
    var sunset = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunset');
    self.debug("getSunset returns {:Dt}", sunset);
    return sunset;
};

TabularScheduler.prototype.getSunrise = function () {
    var self = this;
    var sunrise = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunrise');
    self.debug1("Sunrise", sunrise);
    return sunrise;
};

TabularScheduler.prototype.handleSensor = function(vDev) {
    var self = this;

    var level = vDev.get('metrics:level');
    self.debug1("handleSensor metrics:level", level, "for device", vDev.id);
    if (level !== 'on' && !self.sensors.triggered) return;

    if (level === 'on') {
        if (self.sensors.offTimeout !== undefined) clearTimeout(self.sensors.offTimeout);
        if (self.vDev.get('metrics:level') === 'on') {
            if (self.lights.changeLights(self.sensors.lights, "start", "sensor") > 0) {
                self.sensors.triggered = true;
                self.vDev.doUpdate('sensorsTriggered', true);
                // TODO:
                //self.addNotification('info', "sensor Triggered", 'module');  // Puts out blank message
                //self.addNotification('error', "sensor Triggered pretend error", 'module');
                //self.controller.emit(self.cronName + '.sensor.triggered');
            }
        }
    } else {
        self.sensors.offTimeout = setTimeout(_.bind(self.handleSensorOffTimeout,self), self.sensors.timeoutMillis);
    }
};

TabularScheduler.prototype.handleSensorOffTimeout = function() {
    var self = this;
    self.lights.changeLights(self.sensors.lights, "end", "sensor");
    self.vDev.doUpdate("sensorsTriggered", false);
    self.sensors.triggered = false;
    self.sensors.offTimeout = undefined;
};

// TODO: move these two inline
TabularScheduler.prototype.handleActiveHoursStart = function() {
    var self = this;

    self.vDev.doUpdate('level', 'on');
};

TabularScheduler.prototype.handleActiveHoursEnd = function() {
    // Re-calculate active hours once a day when period ends
    var self = this;
    self.activeHours = self.getActiveHours();
    self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
    // TODO: turn off lights that were triggered by sensors or schedule?

    self.vDev.doUpdate('level', 'off');
};

TabularScheduler.prototype.summary = function() {
    var self = this;
    if (!!self.config.logging) {
        self.log("[S] " + self.fmt.format.apply(self.fmt, arguments));
    }
}

TabularScheduler.prototype.info = function (what) {
    var self = this;
    if (!!self.config.logging && (self.config.logging === 'detailed' || self.config.logging === 'veryDetailed') ) {
        self.log("[I] " + self.fmt.format.apply(self.fmt, arguments));
    }
};

TabularScheduler.prototype.debug = function () {
    var self = this;
    if (!!self.config.logging && self.config.logging === 'veryDetailed') {
        self.log("[D] " + self.fmt.format.apply(self.fmt, arguments));
    }
};

TabularScheduler.prototype.debug1 = function () {
    var self = this;
    if (!!self.config.logging && self.config.logging === 'veryDetailed') {
        self.log(_.reduce(arguments, function (a, b) {
            return a + " " + JSON.stringify(b)
        }));
    }
};

TabularLight = function(device, num, vDev, tabular) {
    this.device = device;
    this.num = num;
    this.title = vDev.get("metrics:title");
    this.onStatus = undefined;
    this.onBy = undefined;
    this.startLevel = undefined;
    this.endLevel = undefined;
    this.tabular = tabular;
};

TabularLight.prototype.getDev = function() {
    return this.tabular.getDev(this.device);
};

TabularLight.prototype.toJSON = function () {
    // Avoid circular dependency when using JSON.stringify
    return _.omit(this, ["tabular"]);
};

TabularLight.prototype.getRef = function() {
    return 'Light/' + this.num + ' ' + (!!this.ref ? this.ref : this.title) + '/' + this.device;
};

TabularLight.prototype.setOnStatus = function(vDev) {
    this.onStatus = vDev.get("metrics:level") === 'on' ? true : false;
};

TabularLight.prototype.changeLight = function (event, source) {
    var self = this;
    if (!!self.device) {
        if (source === 'sensor' && event === 'end' && self.onBy === 'schedule') {
            return '';
        }
        // TODO: have different modes - only turn on light if already on, check light before turning on, always turn on
        // Record source turning light on, so don't turn off light after sensor off if we've hit light scheduled start
        if (event === 'start') {
            if (self.onBy !== 'schedule') self.onBy = source;
        } else {
            self.onBy = undefined;
        }
        var onOff = (event === "start") ? 'on' : 'off';
        self.getDev().performCommand(onOff);

        self.tabular.summary("changeLight due to {}:{} {} turning {}", source, event, self.getRef(), onOff);
        if (source === 'schedule') {
            self.tabular.vDev.doUpdateNum('onBySchedule', event === 'start' ? 1 : -1);
        }
        return (event === "start") ? 'turnedOn' : 'turnedOff';
    }
    return '';
};

TabularFormat = function() {
    this.days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    this.months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
};

TabularFormat.prototype.shortDateTimeFormat = function(date) {
    if (date == null) return '-';
    var self = this;
    return date == null ? "-"
        : self.days[date.getDay()] + " " + date.getDate() + "-" + self.months[date.getMonth()] + " " +
        ('00' + date.getHours()).slice(-2) + ":" + ('00' + date.getMinutes()).slice(-2);
};

TabularFormat.prototype.dayAndTimeFormat = function(date) {
    return date == null ? "-" : this.days[date.getDay()] + " " + ('00' + date.getHours()).slice(-2) + ":" + ('00' + date.getMinutes()).slice(-2);
};

TabularFormat.prototype.format = function() {
    var self = this;
    var formatting = arguments[0];
    if (arguments.length == 1) return formatting;
    if (arguments.length > 1) {
        var isObj = arguments.length === 2 && typeof arguments[1] == 'object';
        var args = isObj //("string" === t || "number" === t)
            ? arguments[1] : Array.prototype.slice.call(arguments, 1);

        var pos = 0;
        return formatting.replace(/\{([^:}]*)(:([^}]+))?\}/g, function (match, p1, p2, p3) {
            var key = p1 === '' ? pos : p1;
            var fmt = p3 === undefined ? '' : p3;
            var val = isObj && !pos && p1 === '' ? args : (args == null ? null : args[key]);
            pos++;
            var s = '';
            if (fmt.charAt(0) === '=') {//startsWith('=')) {
                fmt = fmt.slice(1);
                s = key + '=';
            }
            switch (fmt) {
                case '':   return s + val;
                case 'p':  return s + val;
                case 'Dt': return s + self.shortDateTimeFormat(val);
                case 'D1': return s + self.dayAndTimeFormat(val);
                case 'EEE': return s + self.days[val.getDay()];
                case 'S':  return s + JSON.stringify(val);
                case 's':  return s + val.toString();
                case 'T':  return s +val.constructor.name;
                default:   return s + val;
            }
        });
    }
};

