#!/usr/bin/env node
/**
* @author Mitchell Seaton
*/
var fs = require('fs'), path = require('path'), utile = require('utile'), libxml = require('libxmljs');
var argv = require('optimist')
		.usage('Convert eSciDoc SRW query results to JSON for TimelineJS.\nUsage: $0 -f [input]')
		.demand(['f'])
		.alias('f', 'file') // File eSciDoc SRW XML
		.alias('O', 'output') // Output file name
		.alias('d', 'dir') // Target directory for output file
		.boolean('p') // Use JSONP as output format
		.default('d', '_files/')
		.describe('f', 'eSciDoc SRW query (XML)')
		.describe('O', 'Output file name.')
		.describe('d', 'Target directory for output.')
		.describe('p', 'Using JSONP (JSON with padding) format.')
		.check(function(opts) {
		  if(path.extname(opts.f) != '.xml') throw new Error('Input file (-f) must have XML extension.')
		  return true;
		})
		.argv;

var is_json_p = argv.p; // true if we require JSONP (cross-domain, local)
var xml_docs = new Array();
var period_map = {}, json_obj = {};
var file_read_length = 1, temp_filename = null;

// eSciDoc 1.3.x SRW 
var ns_obj = {'sru-zr':'http://www.loc.gov/zing/srw/',
		'escidocItem':'http://www.escidoc.de/schemas/item/0.10',
		'escidocMetadataRecords':'http://www.escidoc.de/schemas/metadatarecords/0.5',
		'escidocContentStreams':'http://www.escidoc.de/schemas/contentstreams/0.7',
		'escidocComponents':'http://www.escidoc.de/schemas/components/0.9',
		'version':'http://escidoc.de/core/01/properties/version/',
		'release':'http://escidoc.de/core/01/properties/release/',
		'prop':'http://escidoc.de/core/01/properties/',
		'srel':'http://escidoc.de/core/01/structural-relations/',
		'xlink':'http://www.w3.org/1999/xlink' };

// read a File in as input SRW query XML data
var readFile = function(file) {
  fs.readFile(file, 'utf8', function (err, data) {
    if (err) throw err;
    file_read_length--;
    parse(libxml.parseXmlString(data));
  });
}

// Parse and pull data from the XMLDocument
var parse = function(doc) {
    var totalRecords = doc.get('//sru-zr:numberOfRecords', ns_obj).text();
    console.log('Total records in query: ' + totalRecords);
 
    var items = doc.find('//escidocItem:item', ns_obj); 
    if(utile.isArray(items)) console.log('Found ' + items.length + ' items.');
    else console.error('Found 0 items in XMLDocument.');
 
    // Add the timeline items
    utile.each(items, function(val, key) {
      var creation_date = val.get('escidocMetadataRecords:md-records/escidocMetadataRecords:md-record/CMD/Components/olac/created', ns_obj).text();
    
      if(!period_map[creation_date]) {
    	var title = val.attr('title').value();
    	var description = val.get('escidocMetadataRecords:md-records/escidocMetadataRecords:md-record/CMD/Components/olac/description', ns_obj).text();
	var href_attr = val.attr('href').value().split('/');
	var link_tag = '<a href=\"http://clarin.dk/clarindk/item.jsp?id=' + href_attr[href_attr.length-1] + '\">Vis ressource</a>';
	var tag = val.get('escidocMetadataRecords:md-records/escidocMetadataRecords:md-record/CMD/Components/olac/conformsTo', ns_obj).text();
	var date_obj = {headline: title, startDate: creation_date, endDate: creation_date, text: description + '<p>' + link_tag + '</p>'};
	if(tag != null) date_obj.tag = tag;
	date_obj = addOptImage(date_obj, val);	

	json_obj.timeline.date.push(date_obj);
	period_map[creation_date] = 1; // flag example as set
      }
    });

    if(file_read_length == 0)
      process.nextTick(save);
}

// Look for any existing images to use (TEIP5DKCLARIN)
var addOptImage = function(obj, item) {
	var image = item.find('escidocComponents:components/escidocComponents:component/escidocComponents:properties[prop:mime-type="image/jpeg"]', ns_obj)[0];
	if(image != null) {
	  var href = image.attr('href').value().split('/');
	  var itemID = href[3];
	  var componentID = href[6];
	  var publisher = item.get('escidocMetadataRecords:md-records/escidocMetadataRecords:md-record/CMD/Components/olac/publisher', ns_obj);
	  var subject = item.get('escidocMetadataRecords:md-records/escidocMetadataRecords:md-record/CMD/Components/olac/subject', ns_obj);
	  var credit = (publisher != null) ? publisher.text() : '';
	  var search_url = 'https://clarin.dk/clarindk/list.jsp?check_list_text=on&check_list_access_public=on&check_list_access_academic=on&check_list_access_restricted=on&fullsearch=&fullsearch-hidden=Title%2CPublisher+%28CopyrightOwner%29%2CCreator%2CDescription%2CSourceTitle%2CSubject&metadata-1=CreationDate&equals-1=%3D&searchtext-1=' + obj.startDate;
	  var caption = 'Eksempel. \"<a href=\"' + search_url + '\">Søg Alle</a>\" fra denne periode.';
	  var url = 'https://clarin.dk/clarindk/download-proxy.jsp?item=' + itemID + '&component=' + componentID + '&.jpg';
	  
	  // add credit, caption, thumbnail(optional)
	  obj.asset = {media: url, credit: credit, caption: caption};
	  console.log('Image found: ' + image.attr('href').value());
	} else {
	  console.log('No image found: ' + obj.headline);
	} 

	return obj;
}

/* Save JSON format file for TimelineJS */
var save = function() {
  var file_dir = path.normalize(argv.d);
  var file_name = (argv.O) ? argv.O : temp_filename;
  var json_str = JSON.stringify(json_obj, null, 4);
  var json_data = (is_json_p) ? 'storyjs_jsonp_data = ' + json_str : json_str;

  fs.exists(file_dir, function(exists) {
    var file_path = (is_json_p) ? path.join(file_dir, file_name + '.jsonp') : path.join(file_dir, file_name + '.json');
    if(exists)
      fs.writeFile(file_path, json_data, 'utf8', function(err) {
        if (err) throw err;
        console.log('File saved:' + file_path);
    });
    else console.log('Target directory doesn\'t exist: ' + file_dir);
  });
}

// main execution function
var main = function() {
  // TimelineJS heading (JSON config file or from data range?)
  json_obj.timeline =  {type: 'default', headline: '', text: '', startDate: '', date: []};
  
  if(utile.isArray(argv.f)) {
    file_read_length = argv.f.length;
    temp_filename = path.basename(argv.f[0], path.extname(argv.f[0]))
    for(var i=0; i<file_read_length; i++) readFile(argv.f[i]); // read multiple files
  } else {
    temp_filename = path.basename(argv.f, path.extname(argv.f)); 
    readFile(argv.f); // read single file input
  }
}

main(); // execute thread
