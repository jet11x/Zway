//var assert = require('assert');
var assert = require('chai').assert;

//const
leftPad = require('left-pad');
var _ = require('underscore');

// Mocha tests using chai assert
describe('MultiToBinary', function() {
    var baseNow = new Date(2017, 9, 8, 9, 1); // Sunday, BST

    beforeEach(function () {
        clock.setDateAndReset(baseNow);
        config = baseConfig();
    });

    afterEach(function () {
        m2b.stop();
        assert.equal(controller.getOnKeys(), '', 'Should be no callbacks still defined');
        controller.reset();
        console.log("\n");
    });

    var executeFile = require('../modules/executeFile');

    this.debugPrint = function (str) {
        console.log(clock.formatedDateTime() + " " + str);
    };

    dgbPrint = function () {
        /*console.log(_.reduce(arguments, function (a, b) {
            return a + " " + JSON.stringify(b)
        }, clock.formatedDateTime()));*/
    };

    this.debug = function () {
    };

    executeFile('automation/Utils.js', this);

    this._ = _;
    this.assert = assert;

    executeFile('test/AutomationControllerMock.js', this);
    executeFile('test/ClockMock.js', this);
    executeFile('test/BaseModuleMock.js', this);
    executeFile('MultiToBinary/index.js', this);

    var clock = new this.ClockMock(baseNow);
    var controller = new this.AutomationController(clock);

    this.setTimeout = function(func, millisecs) {
        //console.log("Got call to setTimeout for " + millisecs + "ms.");
        return clock.setTimeout(_.partial(func, arguments), millisecs);
    };

    this.clearTimeout = function(id) {
        //console.log("clearTime for " + id);
        clock.clearTimeout(id);
    };

    this.MultiToBinary.prototype.log = function(message) {
        self = this;
        console.log(clock.getHRDateformat(self.now()) + " " + message);
    };

    var m2b = new this.MultiToBinary(1, controller);
    m2b.meta.defaults.title = "MultiToBinary";
    m2b.langFile = {m_title:"Multi To Binary"};

    var printf = function() {
        console.log(clock.getHRDateformat(clock.getDate()) + ' ... ' + fmt.format.apply(fmt, arguments));
    };

    var dev = "ZWayVDev_zway_13-0-38";
    var vDev = controller.add(dev, "Bedroom Light", "switchMultilevel");

    var baseConfig = function () {
        return {
            "device": dev,
            "onLevel": 70
        }
    };

    describe("Tests", function() {
        it("Turn binary switch on and off", function() {
            m2b.init(config);
            assert.equal(vDev.timesSetTo['on'], 0);
            assert.equal(vDev.timesSetTo['off'], 0);
            //vDev.performCommand('on');
            m2b.vDev.performCommand('on');
            assert.equal(vDev.timesSetTo['on'], 1);
            assert.equal(vDev.timesSetTo['off'], 0);
            assert.equal(vDev.get('metrics:level'), 70);

            m2b.vDev.performCommand('off');
            assert.equal(vDev.timesSetTo['on'], 1);
            assert.equal(vDev.timesSetTo['off'], 1);
            assert.equal(vDev.get('metrics:level'), 0);
        });

        it("Change level of light", function() {
            m2b.init(config);
            assert.equal(vDev.get('metrics:level'), 0);
            assert.equal(m2b.vDev.get('metrics:level'), 'off');

            vDev.performCommand('exact', {level: 10});
            assert.equal(vDev.get('metrics:level'), 10);
            assert.equal(m2b.vDev.get('metrics:level'), 'on');

            vDev.performCommand('exact', {level: 0});
            assert.equal(m2b.vDev.get('metrics:level'), 'off');
        });

        it("Start with dimmer on", function() {
            vDev.performCommand('exact', {level: 40});
            m2b.init(config);
            assert.equal(m2b.vDev.get('metrics:level'), 'on  ');
        });
    });
});