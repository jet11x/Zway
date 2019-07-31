ClockMock = function(now) {
    this.now = new Date(now.getTime());
    this.oldDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.cron = undefined;
    this.init();
    this.days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    this.sunriseSunset = undefined;
};
ClockMock.prototype.init = function() {
    this.timeouts = {};
    this.intervals = {};
    this.numTimeouts = 0;
    this.numIntervals = 0;
    this.increment = 60*1000;
};


ClockMock.prototype.provideSunriseSunsetTimes = function(times, ts) {
    this.ts = ts;
    // times is array of triples, date, sunrise, sunset
    this.sunriseSunset = _.reduce(times, function(memo, ss) {
        var d = ss.day.split("-");
        var date = new Date(d[0], d[1]-1, d[2]);
        var sunriseP = ss.sunrise.split(":");
        var sunrise = new Date(date);
        sunrise.setHours(sunriseP[0], sunriseP[1]);
        var sunsetP = ss.sunset.split(":");
        var sunset = new Date(date);
        sunset.setHours(sunsetP[0], sunsetP[1]);
        memo[date] = {sunrise:sunrise, sunset:sunset};
        return memo;
    }, {});
}

ClockMock.prototype.setIncrement = function(millis) {
    this.increment = millis;
}

ClockMock.prototype.moveToWithoutCronNotify = function(hours, minutes) {
    var self = this;
    var time = self.now.getTime();
    self.now.setHours(hours, minutes);
    if (self.now.getTime() < time) self.now.setHours(self.now.getHours() + 24);
};

ClockMock.prototype.moveTo = function(hours, minutes) {
    var self = this;
    do {
        self.moveBy(self.increment);
    } while(!(self.now.getHours() === hours && self.now.getMinutes() === minutes));
};

ClockMock.prototype.formatedDateTime = function(toMs) {
    var self = this;
    return self.getDateFormat(self.now, toMs);
};

ClockMock.prototype.getDateFormat = function(dateTime, toMs) {
    var self = this;
    if (!dateTime) return "-";
    var ts = dateTime.getFullYear() + "-";
    ts += ("0" + (dateTime.getMonth() + 1)).slice(-2) + "-";
    ts += ("0" + dateTime.getDate()).slice(-2) + " ";
    ts += ("0" + dateTime.getHours()).slice(-2) + ":";
    ts += ("0" + dateTime.getMinutes()).slice(-2);
    if (toMs) {
        ts += ":" + ("0" + dateTime.getSeconds()).slice(-2);
        ts += "." + ("00" + dateTime.getMilliseconds()).slice(-3);
    }
    ts += " " + self.days[dateTime.getDay()];

    return ts;
};

ClockMock.prototype.getHRDateformat = function(dateTime) {
    return this.getDateFormat(dateTime, false);
}

ClockMock.prototype.moveBy = function(ms) {
    var self = this;
    var time = self.now.getTime();
    var finalTime = time + ms;
    var fractionalIncrement = ms % (self.increment);
    time += fractionalIncrement;
    if (fractionalIncrement > 0) {
        self.setTime(time);
    }
    while (time < finalTime) {
        time += self.increment;
        self.setTime(time);
    }
};

ClockMock.prototype.setTime = function(time) {
    var self = this;
    self.now.setTime(time);
    var day = new Date(time);
    day.setHours(0, 0, 0, 0);
    if (day > self.oldDay) {
        self.oldDay = day;
        if (!!self.sunriseSunset) {
            if (day in self.sunriseSunset) {
                self.ts.metrics[['probeType', '=', 'astronomy_sun_altitude'].join(""), 'metrics:sunrise'] = self.sunriseSunset[day].sunrise;
                self.ts.metrics[['probeType', '=', 'astronomy_sun_altitude'].join(""), 'metrics:sunset'] = self.sunriseSunset[day].sunset;
            } else {
                var sunrise = new Date(day);
                sunrise.setHours(6, 10);
                var sunset = new Date(day);
                sunset.setHours( 21, 5);
                self.ts.metrics[['probeType', '=', 'astronomy_sun_altitude'].join(""), 'metrics:sunrise'] = sunrise;
                self.ts.metrics[['probeType', '=', 'astronomy_sun_altitude'].join(""), 'metrics:sunset'] = sunset;
            }
        }
    }

    self.triggerTimeouts();
    self.triggerIntervals();
    self.notifyCron();
}

ClockMock.prototype.setTimeout = function(fn, ms) {
    var self = this;
    self.numTimeouts++;
    var timeout = {
        "triggerAt": self.getTime() + ms,
        "callback": fn
    }
    self.timeouts[self.numTimeouts] = timeout;
    return self.numTimeouts;
};

ClockMock.prototype.clearTimeout = function(id) {
    var self = this;
    delete self.timeouts[id];
};

ClockMock.prototype.setInterval = function(fn, ms) {
    var self = this;
    self.numIntervals++;
    var interval = {
        delay: ms,
        triggerAt: self.getTime() + ms,
        callback: fn
    }
    self.intervals[self.numIntervals] = interval;
    return self.numIntervals;
};

ClockMock.prototype.clearInterval = function(id) {
    var self = this;
    delete self.intervals[id];
};

ClockMock.prototype.triggerTimeouts = function() {
    var self = this;
    var time = self.getTime();
    var partitions = _.partition(self.timeouts, function(timeout) {
        return !!timeout && timeout.triggerAt <= time;
    });
    _.each(partitions[0], function(timeout) {
        timeout.callback();
    });
    self.timeouts = partitions[1];
}

ClockMock.prototype.triggerIntervals = function() {
    var self = this;
    var time = self.getTime();
    var triggered = _.filter(self.intervals, function(interval) {
        return !!interval && interval.triggerAt <= time;
    });
    _.each(triggered, function(interval) {
        interval.callback();
        interval.triggerAt = time + interval.delay;
        //console.log("new interval " + self.getDateFormat(new Date(interval.triggerAt), true));
    });
}

ClockMock.prototype.getIntervals = function() {
    var self = this;
    return _.reduce(self.intervals, function(memo, interval) {
        memo.push(new Date(interval.triggerAt));
        return memo;
    }, []);
}

ClockMock.prototype.setCron = function(cron) {
    this.cron = cron;
};

ClockMock.prototype.notifyCron = function() {
    var self = this;
    self.cron.clockChange(new Date(self.now.getTime()));
};

ClockMock.prototype.cronTime2Date = function(cronTime) {
    var self = this;
    var tmpDate = new Date(self.now);
    if (cronTime.hour == null && cronTime.minute === null) {
        // trigger every minute
        tmpDate.setMinutes(tmpDate.getMinutes() + 1, 0, 0);
        //console.log("Next cron time is " + tmpDate);
    } else {
        tmpDate.setHours(cronTime.hour, cronTime.minute);
        if (tmpDate <= self.now) tmpDate = self.moveTime(tmpDate, 24);
    }
    return tmpDate;
};

ClockMock.prototype.moveTime = function(time, hours) {
    var movedTime = new Date(time.getTime());
    var toHour   = time.getHours();
    var toMinute = time.getMinutes();
    movedTime.setHours(toHour + hours);
    // Correct for DST
    movedTime.setHours(toHour, toMinute);
    return movedTime;
};

ClockMock.prototype.getDate = function() {
    return new Date(this.now.getTime());
};

ClockMock.prototype.setDateAndReset = function(date) {
    var self = this;
    self.init();
    self.setTime(date.getTime());
};

ClockMock.prototype.getTime = function() {
    var self = this;
    return self.now.getTime();
}