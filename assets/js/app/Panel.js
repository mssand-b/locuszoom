/* global d3,Q,LocusZoom */
/* eslint-env browser */
/* eslint-disable no-console */

"use strict";

/**

  LocusZoom.Panel Class

  A panel is an abstract class representing a subdivision of the LocusZoom stage
  to display a distinct data representation

*/

LocusZoom.Panel = function(id, layout, parent) { 

    this.initialized = false;
    
    this.id     = id;
    this.parent = parent || null;
    this.svg    = {};

    // The layout is a serializable object used to describe the composition of the Panel
    this.layout = LocusZoom.mergeLayouts(layout || {}, LocusZoom.Panel.DefaultLayout);

    // Define state parameters specific to this panel
    if (this.parent){
        this.state = this.parent.state;
        this.state_id = this.id;
        this.state[this.state_id] = this.state[this.state_id] || {};
    } else {
        this.state = null;
        this.state_id = null;
    }
    
    this.data_layers = {};
    this.data_layer_ids_by_z_index = [];
    this.data_promises = [];

    this.x_extent  = null;
    this.y1_extent = null;
    this.y2_extent = null;

    this.x_ticks  = [];
    this.y1_ticks = [];
    this.y2_ticks = [];

    this.getBaseId = function(){
        return this.parent.id + "." + this.id;
    };

    this.onUpdate = function(){
        this.parent.onUpdate();
    };
    
    // Get an object with the x and y coordinates of the panel's origin in terms of the entire page
    // Necessary for positioning any HTML elements over the panel
    this.getPageOrigin = function(){
        var instance_origin = this.parent.getPageOrigin();
        return {
            x: instance_origin.x + this.layout.origin.x,
            y: instance_origin.y + this.layout.origin.y
        };
    };

    // Initialize the layout
    this.initializeLayout();
    
    return this;
    
};

LocusZoom.Panel.DefaultLayout = {
    title: null,
    description: null,
    y_index: null,
    width:  0,
    height: 0,
    origin: { x: 0, y: 0 },
    min_width: 1,
    min_height: 1,
    proportional_width: null,
    proportional_height: null,
    proportional_origin: { x: 0, y: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    controls: {
        description: true,
        reposition: true,
        remove: true
    },
    cliparea: {
        height: 0,
        width: 0,
        origin: { x: 0, y: 0 }
    },
    axes: {
        x:  {},
        y1: {},
        y2: {}
    }
};

LocusZoom.Panel.prototype.initializeLayout = function(){

    // If the layout is missing BOTH width and proportional width then set the proportional width to 1.
    // This will default the panel to taking up the full width of the plot.
    if (this.layout.width == 0 && this.layout.proportional_width == null){
        this.layout.proportional_width = 1;
    }

    // If the layout is missing BOTH height and proportional height then set the proportional height to
    // an equal share of the plot's current height.
    if (this.layout.height == 0 && this.layout.proportional_height == null){
        var panel_count = Object.keys(this.parent.panels).length;
        if (panel_count > 0){
            this.layout.proportional_height = (1 / panel_count);
        } else {
            this.layout.proportional_height = 1;
        }
    }

    // Set panel dimensions, origin, and margin
    this.setDimensions();
    this.setOrigin();
    this.setMargin();

    // Initialize panel axes
    ["x", "y1", "y2"].forEach(function(axis){
        if (!Object.keys(this.layout.axes[axis]).length || this.layout.axes[axis].render === false){
            // The default layout sets the axis to an empty object, so set its render boolean here
            this.layout.axes[axis].render = false;
        } else {
            this.layout.axes[axis].render = true;
            this.layout.axes[axis].label = this.layout.axes[axis].label || null;
            this.layout.axes[axis].label_function = this.layout.axes[axis].label_function || null;
        }
    }.bind(this));

    // Add data layers (which define x and y extents)
    if (typeof this.layout.data_layers == "object"){
        var data_layer_id;
        for (data_layer_id in this.layout.data_layers){
            this.addDataLayer(data_layer_id, this.layout.data_layers[data_layer_id]);
        }
    }

};

LocusZoom.Panel.prototype.setDimensions = function(width, height){
    if (typeof width != "undefined" && typeof height != "undefined"){
        if (!isNaN(width) && width >= 0 && !isNaN(height) && height >= 0){
            this.layout.width = Math.max(Math.round(+width), this.layout.min_width);
            this.layout.height = Math.max(Math.round(+height), this.layout.min_height);
        }
    } else {
        if (this.layout.proportional_width != null){
            this.layout.width = Math.max(this.layout.proportional_width * this.parent.layout.width, this.layout.min_width);
        }
        if (this.layout.proportional_height != null){
            this.layout.height = Math.max(this.layout.proportional_height * this.parent.layout.height, this.layout.min_height);
        }
    }
    this.layout.cliparea.width = Math.max(this.layout.width - (this.layout.margin.left + this.layout.margin.right), 0);
    this.layout.cliparea.height = Math.max(this.layout.height - (this.layout.margin.top + this.layout.margin.bottom), 0);
    if (this.svg.clipRect){
        this.svg.clipRect.attr("width", this.layout.width).attr("height", this.layout.height);
    }
    
    if (this.initialized){ this.render(); }
    return this;
};

LocusZoom.Panel.prototype.setOrigin = function(x, y){
    if (!isNaN(x) && x >= 0){ this.layout.origin.x = Math.max(Math.round(+x), 0); }
    if (!isNaN(y) && y >= 0){ this.layout.origin.y = Math.max(Math.round(+y), 0); }
    if (this.initialized){ this.render(); }
    return this;
};

LocusZoom.Panel.prototype.setMargin = function(top, right, bottom, left){
    var extra;
    if (!isNaN(top)    && top    >= 0){ this.layout.margin.top    = Math.max(Math.round(+top),    0); }
    if (!isNaN(right)  && right  >= 0){ this.layout.margin.right  = Math.max(Math.round(+right),  0); }
    if (!isNaN(bottom) && bottom >= 0){ this.layout.margin.bottom = Math.max(Math.round(+bottom), 0); }
    if (!isNaN(left)   && left   >= 0){ this.layout.margin.left   = Math.max(Math.round(+left),   0); }
    if (this.layout.margin.top + this.layout.margin.bottom > this.layout.height){
        extra = Math.floor(((this.layout.margin.top + this.layout.margin.bottom) - this.layout.height) / 2);
        this.layout.margin.top -= extra;
        this.layout.margin.bottom -= extra;
    }
    if (this.layout.margin.left + this.layout.margin.right > this.layout.width){
        extra = Math.floor(((this.layout.margin.left + this.layout.margin.right) - this.layout.width) / 2);
        this.layout.margin.left -= extra;
        this.layout.margin.right -= extra;
    }
    ["top", "right", "bottom", "left"].forEach(function(m){
        this.layout.margin[m] = Math.max(this.layout.margin[m], 0);
    }.bind(this));
    this.layout.cliparea.width = Math.max(this.layout.width - (this.layout.margin.left + this.layout.margin.right), 0);
    this.layout.cliparea.height = Math.max(this.layout.height - (this.layout.margin.top + this.layout.margin.bottom), 0);
    this.layout.cliparea.origin.x = this.layout.margin.left;
    this.layout.cliparea.origin.y = this.layout.margin.top;

    if (this.initialized){ this.render(); }
    return this;
};

// Initialize a panel
LocusZoom.Panel.prototype.initialize = function(){

    // Append a container group element to house the main panel group element and the clip path
    // Position with initial layout parameters
    this.svg.container = this.parent.svg.insert("svg:g", "#" + this.parent.id + "\\.ui")
        .attr("id", this.getBaseId() + ".panel_container")
        .attr("transform", "translate(" + this.layout.origin.x +  "," + this.layout.origin.y + ")");

    // Append clip path to the parent svg element, size with initial layout parameters
    var clipPath = this.svg.container.append("clipPath")
        .attr("id", this.getBaseId() + ".clip");
    this.svg.clipRect = clipPath.append("rect")
        .attr("width", this.layout.width).attr("height", this.layout.height);
    
    // Append svg group for rendering all panel child elements, clipped by the clip path
    this.svg.group = this.svg.container.append("g")
        .attr("id", this.getBaseId() + ".panel")
        .attr("clip-path", "url(#" + this.getBaseId() + ".clip)");

    // Append a curtain element with svg element and drop/raise methods
    var panel_curtain_svg = this.svg.container.append("g")
        .attr("id", this.getBaseId() + ".curtain")
        .attr("clip-path", "url(#" + this.getBaseId() + ".clip)")
        .attr("class", "lz-curtain").style("display", "none");
    this.curtain = {
        svg: panel_curtain_svg,
        drop: function(message){
            this.svg.style("display", null);
            if (typeof message != "undefined"){
                try {
                    this.svg.select("text").selectAll("tspan").remove();
                    message.split("\n").forEach(function(line){
                        this.svg.select("text").append("tspan")
                            .attr("x", "1em").attr("dy", "1.5em").text(line);
                    }.bind(this));
                    this.svg.select("text").append("tspan")
                        .attr("x", "1em").attr("dy", "2.5em")
                        .attr("class", "dismiss").text("Dismiss")
                        .on("click", function(){
                            this.raise();
                        }.bind(this));
                } catch (e){
                    console.error("LocusZoom tried to render an error message but it's not a string:", message);
                }
            }
        },
        raise: function(){
            this.svg.style("display", "none");
        }
    };
    this.curtain.svg.append("rect").attr("width", "100%").attr("height", "100%");
    this.curtain.svg.append("text")
        .attr("id", this.getBaseId() + ".curtain_text")
        .attr("x", "1em").attr("y", "0em");

    // Initialize controls element
    this.controls = {
        selector: null,
        hide_timeout: null,
        link_selectors: {},
        show: function(){
            if (!this.layout.controls || this.controls.selector){ return; }
            this.controls.selector = d3.select(this.parent.svg.node().parentNode).insert("div", ".lz-data_layer-tooltip")
                .attr("class", "lz-locuszoom-controls lz-locuszoom-panel-controls")
                .attr("id", this.getBaseId() + ".controls")
                .style({ position: "absolute" });
            // Reposition buttons
            if (this.layout.controls.reposition){
                this.controls.link_selectors.reposition_up = this.controls.selector.append("a")
                    .attr("class", "lz-panel-controls-button-disabled")
                    .attr("title", "Move panel up")
                    .style({ "font-weight": "bold" })
                    .text("▴")
                    .on("click", function(){
                        if (this.parent.panel_ids_by_y_index[this.layout.y_index - 1]){
                            this.parent.panel_ids_by_y_index[this.layout.y_index] = this.parent.panel_ids_by_y_index[this.layout.y_index - 1];
                            this.parent.panel_ids_by_y_index[this.layout.y_index - 1] = this.id;
                            this.parent.applyPanelYIndexesToPanelLayouts();
                            this.parent.positionPanels();
                        }
                    }.bind(this));
                this.controls.link_selectors.reposition_down = this.controls.selector.append("a")
                    .attr("class", "lz-panel-controls-button-disabled")
                    .attr("title", "Move panel down")
                    .style({ "font-weight": "bold" })
                    .text("▾")
                    .on("click", function(){
                        if (this.parent.panel_ids_by_y_index[this.layout.y_index + 1]){
                            this.parent.panel_ids_by_y_index[this.layout.y_index] = this.parent.panel_ids_by_y_index[this.layout.y_index + 1];
                            this.parent.panel_ids_by_y_index[this.layout.y_index + 1] = this.id;
                            this.parent.applyPanelYIndexesToPanelLayouts();
                            this.parent.positionPanels();
                        }
                    }.bind(this));
            }
            // Description button
            if (this.layout.controls.description && this.layout.description){
                this.controls.link_selectors.description = this.controls.selector.append("a")
                    .attr("class", "lz-panel-controls-button")
                    .attr("title", "View panel information")
                    .style({ "font-weight": "bold" })
                    .text("?")
                    .on("click", function(){
                        if (this.controls.description.is_showing){
                            this.controls.description.hide();
                        } else {
                            this.controls.description.show();
                            this.controls.description.position();
                        }
                    }.bind(this));
                this.controls.description = {
                    is_showing: false,
                    selector: null,
                    show: function(){
                        this.controls.link_selectors.description.attr("class", "lz-panel-controls-button-selected");
                        this.controls.description.selector = d3.select(this.parent.svg.node().parentNode).append("div")
                            .attr("class", "lz-panel-description")
                            .attr("id", this.getBaseId() + ".description")
                            .html(this.layout.description);
                        this.controls.description.is_showing = true;
                    }.bind(this),
                    position: function(){
                        var padding = 4; // is there a better place to store this?
                        var page_origin = this.getPageOrigin();
                        var controls_client_rect = this.controls.selector.node().getBoundingClientRect();
                        var desc_client_rect = this.controls.description.selector.node().getBoundingClientRect();
                        var top = (page_origin.y + controls_client_rect.height + padding).toString() + "px";
                        var left = Math.max(page_origin.x + this.layout.width - desc_client_rect.width - padding, page_origin.x + padding).toString() + "px";
                        this.controls.description.selector.style({ top: top, left: left });
                    }.bind(this),
                    hide: function(){
                        this.controls.link_selectors.description.attr("class", "lz-panel-controls-button");
                        this.controls.description.selector.remove();
                        this.controls.description.is_showing = false;
                    }.bind(this)
                };
            }
            // Remove button
            if (this.layout.controls.remove){
                this.controls.link_selectors.remove = this.controls.selector.append("a")
                    .attr("class", "lz-panel-controls-button")
                    .attr("title", "Remove panel")
                    .style({ "font-weight": "bold" })
                    .text("×")
                    .on("click", function(){
                        // Hide description and controls
                        if (this.controls.description && this.controls.description.is_showing){ this.controls.description.hide(); }
                        this.controls.hide();
                        // Remove mouse event listeners for these controls
                        d3.select(this.parent.svg.node().parentNode).on("mouseover." + this.getBaseId() + ".controls", null);
                        d3.select(this.parent.svg.node().parentNode).on("mouseout." + this.getBaseId() + ".controls", null);
                        // Remove the panel
                        this.parent.removePanel(this.id);
                    }.bind(this));
            }
        }.bind(this),
        position: function(){
            var page_origin = this.getPageOrigin();
            var client_rect = this.controls.selector.node().getBoundingClientRect();
            var top = page_origin.y.toString() + "px";
            var left = (page_origin.x + this.layout.width - client_rect.width).toString() + "px";
            this.controls.selector.style({ position: "absolute", top: top, left: left });
            // Position description box if it's showing
            if (this.controls.description && this.controls.description.is_showing){
                this.controls.description.position();
            }
            // Apply appropriate classes to reposition buttons as needed
            if (this.controls.link_selectors.reposition_up){
                this.controls.link_selectors.reposition_up.attr("class", (this.layout.y_index == 0) ? "lz-panel-controls-button-disabled" : "lz-panel-controls-button");
            }
            if (this.controls.link_selectors.reposition_down){
                this.controls.link_selectors.reposition_down.attr("class", (this.layout.y_index == this.parent.panel_ids_by_y_index.length - 1) ? "lz-panel-controls-button-disabled" : "lz-panel-controls-button");
            }
        }.bind(this),
        hide: function(){
            if (!this.layout.controls || !this.controls.selector){ return; }
            // Do not hide if this panel is showing a description
            if (this.controls.description && this.controls.description.is_showing){ return; }
            // Do not hide if actively in an instance-level drag event
            if (this.parent.ui.dragging || this.parent.panel_boundaries.dragging){ return; }
            this.controls.selector.remove();
            this.controls.selector = null;
        }.bind(this)
    };

    // If controls are defined add mouseover controls to the plot container to show/hide them
    if (this.layout.controls){
        d3.select(this.parent.svg.node().parentNode).on("mouseover." + this.getBaseId() + ".controls", function(){
            clearTimeout(this.controls.hide_timeout);
            this.controls.show();
            this.controls.position();
        }.bind(this));
        d3.select(this.parent.svg.node().parentNode).on("mouseout." + this.getBaseId() + ".controls", function(){
            this.controls.hide_timeout = setTimeout(function(){
                this.controls.hide();
            }.bind(this), 300);
        }.bind(this));
    }

    // If the layout defines an inner border render it before rendering axes
    if (this.layout.inner_border){
        this.inner_border = this.svg.group.append("rect");
    }

    // Add the title, if defined
    if (this.layout.title){
        var default_x = 10;
        var default_y = 22;
        if (typeof this.layout.title == "string"){
            this.layout.title = {
                text: this.layout.title,
                x: default_x,
                y: default_y
            };
        }
        this.svg.group.append("text")
            .attr("class", "lz-panel-title")
            .attr("x", parseFloat(this.layout.title.x) || default_x)
            .attr("y", parseFloat(this.layout.title.y) || default_y)
            .text(this.layout.title.text);
    }

    // Initialize Axes
    this.svg.x_axis = this.svg.group.append("g")
        .attr("id", this.getBaseId() + ".x_axis").attr("class", "lz-x lz-axis");
    if (this.layout.axes.x.render){
        this.svg.x_axis_label = this.svg.x_axis.append("text")
            .attr("class", "lz-x lz-axis lz-label")
            .attr("text-anchor", "middle");
    }
    this.svg.y1_axis = this.svg.group.append("g")
        .attr("id", this.getBaseId() + ".y1_axis").attr("class", "lz-y lz-y1 lz-axis");
    if (this.layout.axes.y1.render){
        this.svg.y1_axis_label = this.svg.y1_axis.append("text")
            .attr("class", "lz-y1 lz-axis lz-label")
            .attr("text-anchor", "middle");
    }
    this.svg.y2_axis = this.svg.group.append("g")
        .attr("id", this.getBaseId() + ".y2_axis").attr("class", "lz-y lz-y2 lz-axis");
    if (this.layout.axes.y2.render){
        this.svg.y2_axis_label = this.svg.y2_axis.append("text")
            .attr("class", "lz-y2 lz-axis lz-label")
            .attr("text-anchor", "middle");
    }

    // Initialize child Data Layers
    this.data_layer_ids_by_z_index.forEach(function(id){
        this.data_layers[id].initialize();
    }.bind(this));

    return this;
    
};


// Create a new data layer by layout object
LocusZoom.Panel.prototype.addDataLayer = function(id, layout){

    // Sanity checks
    if (typeof id !== "string"){
        throw "Invalid data layer id passed to LocusZoom.Panel.prototype.addDataLayer()";
    }
    if (typeof layout !== "object"){
        throw "Invalid data layer layout passed to LocusZoom.Panel.prototype.addDataLayer()";
    }
    if (typeof this.data_layers[layout.id] !== "undefined"){
        throw "Cannot create data layer with id [" + id + "]; data layer with that id already exists";
    }
    if (typeof layout.type !== "string"){
        throw "Invalid data layer type in layout passed to LocusZoom.Panel.prototype.addDataLayer()";
    }

    // If the layout defines a y axis make sure the axis number is set and is 1 or 2 (default to 1)
    if (typeof layout.y_axis == "object" && (typeof layout.y_axis.axis == "undefined" || [1,2].indexOf(layout.y_axis.axis) == -1)){
        layout.y_axis.axis = 1;
    }

    // Create the Data Layer
    var data_layer = LocusZoom.DataLayers.get(layout.type, id, layout, this);

    // Store the Data Layer on the Panel
    this.data_layers[data_layer.id] = data_layer;

    // If a discrete z_index was set in the layout then adjust other data layer z_index values to accomodate this one
    if (data_layer.layout.z_index != null && !isNaN(data_layer.layout.z_index)
        && this.data_layer_ids_by_z_index.length > 0){
        // Negative z_index values should count backwards from the end, so convert negatives to appropriate values here
        if (data_layer.layout.z_index < 0){
            data_layer.layout.z_index = Math.max(this.data_layer_ids_by_z_index.length + data_layer.layout.z_index, 0);
        }
        this.data_layer_ids_by_z_index.splice(data_layer.layout.z_index, 0, data_layer.id);
        this.data_layer_ids_by_z_index.forEach(function(dlid, idx){
            this.data_layers[dlid].layout.z_index = idx;
        }.bind(this));
    } else {
        var length = this.data_layer_ids_by_z_index.push(data_layer.id);
        this.data_layers[data_layer.id].layout.z_index = length - 1;
    }

    // If not present, store the data layer layout in the panel layout
    if (typeof this.layout.data_layers[data_layer.id] == "undefined"){
        this.layout.data_layers[data_layer.id] = this.data_layers[data_layer.id].layout;
    }

    return this.data_layers[data_layer.id];
};


// Re-Map a panel to new positions according to the parent instance's state
LocusZoom.Panel.prototype.reMap = function(){
    this.data_promises = [];
    // Trigger reMap on each Data Layer
    for (var id in this.data_layers){
        try {
            this.data_promises.push(this.data_layers[id].reMap());
        } catch (error) {
            console.log(error);
            this.curtain.drop(error);
        }
    }
    // When all finished trigger a render
    return Q.all(this.data_promises)
        .then(function(){
            this.initialized = true;
            this.render();
        }.bind(this))
        .catch(function(error){
            console.log(error);
            this.curtain.drop(error);
        }.bind(this));
};

// Iterate over data layers to generate panel axis extents
LocusZoom.Panel.prototype.generateExtents = function(){

    // Reset extents
    this.x_extent = null;
    this.y1_extent = null;
    this.y2_extent = null;

    // Loop through the data layers
    for (var id in this.data_layers){

        var data_layer = this.data_layers[id];

        // If defined and not decoupled, merge the x extent of the data layer with the panel's x extent
        if (data_layer.layout.x_axis && !data_layer.layout.x_axis.decoupled){
            this.x_extent = d3.extent((this.x_extent || []).concat(data_layer.getAxisExtent("x")));
        }

        // If defined and not decoupled, merge the y extent of the data layer with the panel's appropriate y extent
        if (data_layer.layout.y_axis && !data_layer.layout.y_axis.decoupled){
            var y_axis = "y" + data_layer.layout.y_axis.axis;
            this[y_axis+"_extent"] = d3.extent((this[y_axis+"_extent"] || []).concat(data_layer.getAxisExtent("y")));
        }
        
    }

    // Override x_extent from state if explicitly defined to do so
    if (this.layout.axes.x && this.layout.axes.x.extent == "state"){
        this.x_extent = [ this.state.start, this.state.end ];
    }    

};


// Render a given panel
LocusZoom.Panel.prototype.render = function(){

    // Position the panel container
    this.svg.container.attr("transform", "translate(" + this.layout.origin.x +  "," + this.layout.origin.y + ")");

    // Set size on the clip rect
    this.svg.clipRect.attr("width", this.layout.width).attr("height", this.layout.height);

    // Set and position the inner border, if necessary
    if (this.layout.inner_border){
        this.inner_border
            .attr("x", this.layout.margin.left).attr("y", this.layout.margin.top)
            .attr("width", this.layout.width - (this.layout.margin.left + this.layout.margin.right))
            .attr("height", this.layout.height - (this.layout.margin.top + this.layout.margin.bottom))
            .style({ "fill": "none",
                     "stroke-width": 1,
                     "stroke": this.layout.inner_border });
    }

    // Regenerate all extents
    this.generateExtents();

    // Generate ticks and scales using generated extents
    if (this.x_extent){
        if (this.layout.axes.x.ticks){
            this.x_ticks = this.layout.axes.x.ticks;
        } else {
            this.x_ticks = LocusZoom.prettyTicks(this.x_extent, "both", this.layout.cliparea.width/120);
        }
        this.x_scale = d3.scale.linear()
            .domain([this.x_extent[0], this.x_extent[1]])
            .range([0, this.layout.cliparea.width]);
    }
    if (this.y1_extent){
        if (this.layout.axes.y1.ticks){
            this.y1_ticks = this.layout.axes.y1.ticks;
        } else {
            this.y1_ticks = LocusZoom.prettyTicks(this.y1_extent);
        }
        this.y1_extent = d3.extent(this.y1_extent.concat(this.y1_ticks));
        this.y1_scale = d3.scale.linear()
            .domain([this.y1_extent[0], this.y1_extent[1]])
            .range([this.layout.cliparea.height, 0]);
    }
    if (this.y2_extent){
        if (this.layout.axes.y2.ticks){
            this.y2_ticks = this.layout.axes.y2.ticks;
        } else {
            this.y2_ticks = LocusZoom.prettyTicks(this.y2_extent);
        }
        this.y2_extent = d3.extent(this.y2_extent.concat(this.y2_ticks));
        this.y2_scale = d3.scale.linear()
            .domain([this.y2_extent[0], this.y2_extent[1]])
            .range([this.layout.cliparea.height, 0]);
    }

    // Render axes and labels
    var canRenderAxis = function(axis){
        return (typeof this[axis + "_scale"] == "function" && !isNaN(this[axis + "_scale"](0)));
    }.bind(this);
    
    if (this.layout.axes.x.render && canRenderAxis("x")){
        this.renderAxis("x");
    }

    if (this.layout.axes.y1.render && canRenderAxis("y1")){
        this.renderAxis("y1");
    }

    if (this.layout.axes.y2.render && canRenderAxis("y2")){
        this.renderAxis("y2");
    }

    // Render data layers in order by z-index
    this.data_layer_ids_by_z_index.forEach(function(data_layer_id){
        this.data_layers[data_layer_id].draw().render();
    }.bind(this));

    return this;
    
};


// Render ticks for a particular axis
LocusZoom.Panel.prototype.renderAxis = function(axis){

    if (["x", "y1", "y2"].indexOf(axis) == -1){
        throw("Unable to render axis; invalid axis identifier: " + axis);
    }

    // Axis-specific values to plug in where needed
    var axis_params = {
        x: {
            position: "translate(" + this.layout.margin.left + "," + (this.layout.height - this.layout.margin.bottom) + ")",
            orientation: "bottom",
            label_x: this.layout.cliparea.width / 2,
            label_y: (this.layout.axes[axis].label_offset || 0),
            label_rotate: null
        },
        y1: {
            position: "translate(" + this.layout.margin.left + "," + this.layout.margin.top + ")",
            orientation: "left",
            label_x: -1 * (this.layout.axes[axis].label_offset || 0),
            label_y: this.layout.cliparea.height / 2,
            label_rotate: -90
        },
        y2: {
            position: "translate(" + (this.layout.width - this.layout.margin.right) + "," + this.layout.margin.top + ")",
            orientation: "right",
            label_x: (this.layout.axes[axis].label_offset || 0),
            label_y: this.layout.cliparea.height / 2,
            label_rotate: -90
        }
    };

    // Determine if the ticks are all numbers (d3-automated tick rendering) or not (manual tick rendering)
    var ticksAreAllNumbers = (function(ticks){
        for (var i = 0; i < ticks.length; i++){
            if (isNaN(ticks[i])){
                return false;
            }
        }
        return true;
    })(this[axis+"_ticks"]);

    // Initialize the axis; set scale and orientation
    this[axis+"_axis"] = d3.svg.axis()
        .scale(this[axis+"_scale"]).orient(axis_params[axis].orientation);

    // Set tick values and format
    if (ticksAreAllNumbers){
        this[axis+"_axis"].tickValues(this[axis+"_ticks"]);
        if (this.layout.axes[axis].tick_format == "region"){
            this[axis+"_axis"].tickFormat(function(d) { return LocusZoom.positionIntToString(d); });
        }
    } else {
        var ticks = this[axis+"_ticks"].map(function(t){
            return(t.x);
        });
        this[axis+"_axis"].tickValues(ticks)
            .tickFormat(function(t, i) { return this[axis+"_ticks"][i].text; }.bind(this));
    }

    // Position the axis in the SVG and apply the axis construct
    this.svg[axis+"_axis"]
        .attr("transform", axis_params[axis].position)
        .call(this[axis+"_axis"]);

    // If necessary manually apply styles and transforms to ticks as specified by the layout
    if (!ticksAreAllNumbers){
        var tick_selector = d3.selectAll("g#" + this.getBaseId().replace(".","\\.") + "\\." + axis + "_axis g.tick");
        var panel = this;
        tick_selector.each(function(d, i){
            var selector = d3.select(this).select("text");
            if (panel[axis+"_ticks"][i].style){
                selector.style(panel[axis+"_ticks"][i].style);
            }
            if (panel[axis+"_ticks"][i].transform){
                selector.attr("transform", panel[axis+"_ticks"][i].transform);
            }
        });
    }

    // Render the axis label if necessary
    var label = this.layout.axes[axis].label || null;
    if (this.layout.axes[axis].label_function){
        label = LocusZoom.LabelFunctions.get(this.layout.axes[axis].label_function, this.state);
    }
    if (label != null){
        this.svg[axis+"_axis_label"]
            .attr("x", axis_params[axis].label_x).attr("y", axis_params[axis].label_y)
            .text(label);
        if (axis_params[axis].label_rotate != null){
            this.svg[axis+"_axis_label"]
                .attr("transform", "rotate(" + axis_params[axis].label_rotate + " " + axis_params[axis].label_x + "," + axis_params[axis].label_y + ")");
        }
    }

};
