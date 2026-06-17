(function(){
  "use strict";
// Broker for fastpack messages

class HustleTable {

  constructor(){

    this.default={matcher: undefined, value: [function(){}, undefined], type:'exact'};// Default entry
    this.table=[];
    this.cache={};

    this.dispatcher=(input)=>{

      //Check the cache first
      let results=[];
      let cached=this.cache[input];
      if(cached){
        //Found return the value
        for(let i=0; i<cached.length; i++){
          results.push(cached[i]);
        }
        
      }
      else{
        for(let i=0; i<this.table.length; i++){
          let entry=this.table[i];
          if(entry.type == "exact"){
            if(entry.matcher == input){
              (this.cache[input]||=[]).push(entry, undefined);
              results.push(entry, undefined);
            }
          }
          else if(entry.type == 'begin'){
            if(input.startsWith(entry.matcher)){
              (this.cache[input]||=[]).push(entry, undefined);
              results.push(entry, undefined);
            }
          }
          // NOTE: Use the type as a compiled regex
          //else if(entry.type == undefined){
          else {
            let strings=entry.type.exec(input);
            if( strings != null){
              strings.shift();  // Remove matching string to leave the captures
              (this.cache[input]||=[]).push(entry, strings);
              results.push(entry, undefined);
            }
          }
        }

        //Default if nothing found already
        if(results.length==0){
          // default matcher... is exact 
          (this.cache[input]||=[]).push(this.default, undefined);
          results.push(this.default, undefined);
        }
      }

      return results;
    };
  }


}



class uSACFastPackBrokerBridge {
  constructor(broker, forward){

    broker||=new uSACFastPackBroker();
    this.broker=broker;

    // rx ns converts inboud codes to ids from remote 
    this.rx_namespace=fastpack.create_namespace();
    
    // rx ns converts outboud ids to codes before sent to remote
    this.tx_namespace=fastpack.create_namespace();


    // This is called internally update external sinks
    this.buffer_out_sub=undefined;


    this.forward_message_sub= (arr, cb)=>{
      let source=arr.shift();
      let inputs=arr[0];


      let arg={buffer:undefined, inputs:undefined, ns:this.tx_namespace};
      let _inputs=[];
      for(let i=0;i<inputs.length;i+=2){

        let msg=inputs[i];
        if(msg.id==0){
          msg.payload= fastpack.encode_meta_payload(msg.payload);
        }
        _inputs.push(msg);
        //arg.inputs=[msg];
      }

      arg.inputs=_inputs;
      fastpack.encode_message(arg);

      
      this.buffer_out_sub && this.buffer_out_sub([arg.buffer], cb);
    };

    

    // ONREAD is used to take data incomming and appedn to internal buffer
    // deserialising is done and broker dispatcher is called with parsed
    // messages

    this.on_read_handler=(arr, cb)=>{

      let args={buffer:undefined, outputs:[], ns:this.rx_namespace};
      args.buffer=arr[0];

      fastpack.decode_message(args);
      for(let i=0; i <args.outputs.length; i++){
        let msg=args.outputs[i];
        if(msg.id == '0'){
          msg.payload=fastpack.decode_meta_payload(msg.payload);
          if(msg.payload.listen){
            msg.sub=this.forward_message_sub;
          }

          if (msg.payload.ignore){
            msg.sub=this.forward_message_sub;
          }
          //TODO: Possible remote listen.. 


        }
      }

      this.broker.dispatcher([this.source_id, args.outputs], cb); 

    };

    // Setup default forwarding
    this.forward=forward; //Pairs of  matcher and type in flattend array
    if(this.forward){
      for(let i=0;i<this.forward.length; i+=2){
        this.broker.listen(undefined, this.forward[i], this, this.forward[i+1]);
      }
    }
    
  }
  close(){
    let dispatch=this.broker.dispatcher;
    let obj={ignore: { source: this.source_id, sub: this.forward_message_sub, force:"matcher source"}};
    dispatch([this.source_id,[{ time: Date.now(), id: 0, payload: obj}]]);
  }
}


class uSACFastPackBrokerBridgeWS extends uSACFastPackBrokerBridge{

  constructor(broker, forward, ws){
    super(broker, forward);

    this.ws=ws;

    ws.binaryType="arraybuffer";

    ws.addEventListener("open", ()=>{


      this.buffer_out_sub= (data, cb)=>{
        //console.log("---called ws buffer_out sub", data);
        ws.send(data[0]);
        cb  && cb(); // NOTE this is syncrhonous
      };

      ws.addEventListener("message", 
        (event)=>{
          this.on_read_handler([new Uint8Array(event.data)], undefined); 
        });

      
      ws.addEventListener("close",(event)=>{
        clearInterval(t);
        this.close();

        ws=undefined;
      });


    });
  }
}

class uSACFastPackBrokerBridgeFrame extends uSACFastPackBrokerBridge {
  constructor(broker, forward, peer){
    super(broker, forward);
    this.peer=peer;

    //Set up an event listener to peer window
    peer.addEventListener('message', (event)=>{
      this.on_read_handler([new Uint8Array(event.data)], undefined); 
    });

    this.buffer_out_sub= (data, cb)=>{
      peer.postMessage(data[0],"*");
      cb  && cb(); // NOTE this is syncrhonous
    };

  }
}


  
class uSACFastPackBrokerBridgeStream extends uSACFastPackBrokerBridge {
  constructor(broker, forward){
    super(broker, forward);



    // Setup to send buffers of data to write stream
    this.buffer_out_sub= (data, cb)=>{
      if(this.controller){
        // Only attempt to send if someone has got the read stream
        this.controller.enguque(data[0]);
      }
      cb  && cb(); // NOTE this is syncrhonous
    };
  }

  // Returns the write stream which data can be written to INTO the broker
  get_write_stream(){
    let scope=this;
    if(this.write_stream == undefined){
      this.write_stream=new WritableStream({
        write(chunk){
          scope.on_read_handler([chunk],undefined);
          return Promise.resolve();    
        },
        close(){
        }
      });
    }
    return this.write_stream;
  }

  // Returns the read stream which is FROM the broker
  // NOTE: This queues data !
  get_read_stream(){
    let scope=this;
    if(this.read_stream == undefined){
      this.read_stream=new ReadableStream({
        start(controller){
          //Save controller so we can push data do it
          scope.controller=controller; 
        }
      });
    }
    return this.read_stream;
  }
}

class WebSocketBP extends WebSocket {
  constructor(url, protocols){

    super(url,protocols);

    this.promise;
    this.resolver;
    this.rejecter;
    this.cbs=[];


    this.pending_byte_count=0;
    this.pending_limit=4096*128;

    //Add an on message handler. to listen for UUID of this socket
    this.addEventListener("message", (event)=>{
      if(event.data.length==0){
        //An empty message was received. THis means the far end  has indicated the send bytes is half of max
        this.pending_byte_count-=(this.pending_limit/2);

        //Execute any callbacks saved
        for(let i=0;i<this.cbs.length;i++){
          try {
            cbs[i]();
          }
          catch(e){
            console.log("Error doing WebSocketPB callback");
          }
        }
        this.resolver(); 
        this.promise=undefined;
      }
    });

    this.addEventListener("error", (event)=>{
        //An empty message was received. THis means the far end  has indicated the send bytes is half of max
        this.pending_byte_count=0;
        this.rejecter(); 
        this.promise=undefined;
      }
    );

    this.addEventListener("close", (event)=>{
        //An empty message was received. THis means the far end  has indicated the send bytes is half of max
        this.pending_byte_count=0;
        this.promise=undefined;
      }
    );

    this.addEventListener("open", (event)=>{
        //An empty message was received. THis means the far end  has indicated the send bytes is half of max
        this.pending_byte_count=0;
        this.promise=undefined;
      }
    );

  }

  send_cb(data, cb){
    //Want to make sure the queued memory usage remains low. 
    this.pending_byte_count+=data.length;
    //Check the acknowledgements packet count
    super.send(data);
  
    if(this.pending_byte_count < this.pending_limit){
      // Do callback for more data
      cb  && cb();
    }
    else {
      // message event with 0 size message is needed
      this.cbs.push(cb);
    }
  }

  send(data){
    this.pending_byte_count+=data.length;
    super.send(data);
    if(this.pending_byte_count < this.pending_limit){
        return Promise.resolve();
    }
    else {
      if(this.promise==undefined){
        this.promise=new Promose((resolve, reject)=>{
          this.resolver=resolve;
          this.rejecter=reject;
        });
        return this.promise;
      }
    }
  }
}





class uSACFastPackBroker {
  constructor(){
    this.uuid=uuid4();
    this.default_source_id=uuid4();
    this.ht=new HustleTable();
    this.bridges={};

    this.dispatcher=(inputs)=>{
      let source=inputs[0];
      let messages=inputs[1];

      for(let i=0; i< messages.length; i++){
        let msg=messages[i];
        // Do look up of message id in table
        let entries=this.ht.dispatcher(msg.id); //this.lookup

        for(let j=0; j< entries.length; j+=2){
          let e=entries[j];
          let c=entries[j+1];

          for(let k=0; k< e.value.length; k+=2){
            let sub=e.value[k];
            let source_id=e.value[k+1];
            if((source_id==undefined) || (source!= source_id)){
              sub([source,[msg ,c]]);
            }
          }
        }
      }
    };


    this.broadcaster_sub=(client_id, kv)=>{
      let msgs=[];
      for(let i=0;i<kv.length; i+=2){
        msgs.push({time: Date.now(), id:kv[i], payload:kv[i+1]});
      }
      this.dispatcher([client_id, msgs]);
      return this;
    };


    this.listener_sub=(source_id, name, sub,type)=>{

      if(sub instanceof uSACFastPackBrokerBridge){
        this.add_bridge(sub);
        //support direct addition of bridge
        source_id=sub.source_id;
        sub=sub.forward_message_sub;
      }
      //TODO check if sub is function or object
      let object={
        listen:{
          source:   source_id,
          matcher:  name,
          type:     type,
          sub:      sub
        }
      };


      this.dispatcher([source_id, [{time:Date.now(), id:'0', payload:object}]]);

      return this;
    };


    this.meta_handler=(spec)=>{

      let source_id=spec[0];
      let msgs=spec[1];

      for(let i=0;i<msgs.length; i+=2){
        let msg=msgs[i];
        let object=msg.payload;
        let keys=Object.keys(object);

        for(let j=0; j<keys.length; j++){
          let key=keys[j];
          let value=object[key];

          if(key== "listen"){
            let name=value.matcher; 
            let sub= value.sub;
            delete value.sub;
            let type= value.type;



            let found=undefined;
            for(let k=0; k<this.ht.table.length; k++){
              let e=this.ht.table[k];

              let org_tyoe=type;
              if(!type){
                type=RegExp(name);
              }

              //if((e.matcher.toString() == name.toString()) && (e.type == type)){
              if((e.matcher == name) && (e.type.toString() == type.toString())){
                e.value.push(sub, source_id);
                found=true;
                continue;
              }
            }


            if(!found){
              let o={matcher:name, value:[sub, source_id], type:type};
              this.ht.table.push(o);

              // Reset cache as new entry will need to tested
            }
            this.ht.cache={};

          }
          else if(key=='ignore'){
            let name=value.matcher; 
            let sub= value.sub;
            delete value.sub;
            let type= value.type;

            let force_sub = value.force == "sub";
            let force_source = value.force == "source";
            let force_matcher = value.force == "matcher";


            let found=false;
            for(let k=this.ht.table.length-1; k>=0; k--){
              let e=this.ht.table[k];


              let org_type=type;
              if(!type){
                type=RegExp(name);
              }
              //if((e.matcher.toString() == name.toString()) && (e.type == type)){
              if(force_matcher || ((e.matcher == name) && (e.type.toString() == type.toString()))){

                //if((e.matcher.toString() == name.toString()) && (e.type == type)){

                for(let l=e.value.length-2; l >=0; l-=2){
                  if((force_sub || (e.value[l] == sub )) && 
                    (force_source || (e.value[l+1] == source_id))){
                    e.value.splice(l,2);
                    console.log(" IGNORE SUCCUESS");
                    found=1;
                    continue;
                  }
                }

                if(e.value.length==0){
                  //console.log(" IGNORE SUCCUESS REMOVE ARRAY");
                  this.ht.table.splice(k,1);
                }

              }
            }

            if(found){
              // Reset cache as entires might not match or event exist any longer
              this.ht.cache={};
            }
          }
        }
      }


    };



    this.ignorer_sub=(source_id, name, sub, type, force)=>{
      let object={
        ignore: {
          source:     source_id,
          matcher:    name,
          type:       type,
          sub:        sub,
          force:      force
        }
      };

      this.dispatcher([source_id, [{time:Date.now(), id:'0', payload:object}]]);

      return this;
    };

    //Bootstrap meta handler

    this.ht.table.push({matcher:'0', value:[this.meta_handler, this.uuid], type:"exact"});


  }

  broadcast(client, name, value){
    this.broadcaster_sub(client, [name, value]);
  }

  listen(client, name, sub, type){
    this.listener_sub(client, name, sub, type);
  }

  ignore(client, name, sub, type, force){
    this.ignorer_sub(client, name, sub, type, force);
  }


  add_bridge(bridge){
    this.bridges[bridge.source_id]=bridge;
  }

  remove_bridge(bridge){
    delete this.bridges[bridge.source_id];
  }


  // Create a bridge to the upstream broker.
  //
  // Accepts a pairwsie list of matcher and type to automaticall forward
  // The resulting bridge can be manipulatea as per normal
  // 
  bridge_to_parent(forward, url){
    console.log("CALLED bidge to parent");

    if(this.parent_bridge){
      return Promise.resolve(this.parent_bridge);
    }

    // Attempt to link to parent window or if top level window, attempt to
    // connect back to the host we loaded from
    //
    //let forward=["remote_end_point"];//=[".*"];
    forward||=[];   
    url||="/fastpack/ws";
    let resolver;
    let p=new Promise((resolve,reject)=>{
      resolver=resolve;
    });
    try {
      if(window.self !== window.top){
        //Inside an iframe;
        this.parent_bridge=new uSACFastPackBrokerBridgeFrame(broker, forward, window.top);
        resolver(this.parent_bridge);
      }
      else {
        // We are the top level 
        let ws=new WebSocket(url);
        this.parent_bridge=new uSACFastPackBrokerBridgeWS(broker, forward, ws);
        ws.addEventListener("open",()=>{
          resolver(this.parent_bridge);
        });
      }

      this.add_bridge(this.parent_bridge);

    }
    catch(e){
      console.log("---COULD NOT CREATE BRIDGE TO PARENT? ", e);
      // Cross origin restrictions, we are likely a iframe
      //window.parent_bridge=new uSACFastPackBrokerBridgeFrame(broker, forward, window.top);
    }
    return p;
  }

  //Create a slave channel to the specified listener
  slave_channel_connect(end_point, on_connect) {
    let ch=new uSACFastPackChannel(undefined, this);
    ch.connect(end_point, on_connect);
    return ch;
  }
}


// 'Channel' implementation
// Create a unique grouping or  'namespace' of stream of data. 
// Gives control with ' out of band' control sub topic
// THe mode dictates the names of the sending and recieving sub topics used
//
class uSACFastPackChannel{
  constructor(uuid, broker, mode){
    this.uuid=uuid||uuid4();
    this.mode=mode;
    this.broker=broker;
    
    this.on_data;
    this.on_control;
    this.on_high_watermark;
    this.on_low_watermark;

    this.data_in_name;
    this.control_in_name;

    this.data_in_byte_count=0; // Reported receiption of bytes at peer
    this.data_out_byte_count=0; // How many bytes we have sent out


    this.high_watermark=5000000;
    this.low_watermark=1000000;
  }

  _setup(sender, on_connect){

    if(this.mode == "master"){
      this.data_in_name=this.uuid+"/MISO";   
      this.data_out_name=this.uuid+"/MOSI";   
      this.control_in_name=this.data_in_name+"/CTL";   
      this.control_out_name=this.data_out_name+"/CTL";   

      this.broker.listen(undefined, this.control_in_name, (data)=>{
        this.data_in_byte_count+=data[1][0].payload.length;
        let p=fastpack.decode_meta_payload(data[1][0].payload);
        this.on_control && this.on_control(p);
        //this.on_control && this.on_control(data[1][0].payload);
      },
        "exact"
      );

      let bridge=this.broker.bridges[sender];
      if(bridge){
        // Channel initiated from remote peer/bridge
        // So we need to forward messages. This will add it to the broker if it
        // doesn't already exist
        this.broker.listen(undefined, this.uuid, bridge, "begin");
      }

      //Control channels to listen for
      this.broker.listen(undefined, this.data_in_name, (data)=>{
        this.data_in_byte_count+=data[1][0].payload.length;
        this.on_data && this.on_data(data[1][0].payload);
      },
        "exact"
      );


      //this.send_control("");
      this.send_control({});
      on_connect && on_connect(this);

    }
    else{
      this.data_in_name=this.uuid+"/MOSI";   
      this.data_out_name=this.uuid+"/MISO";   
      this.control_in_name=this.data_in_name+"/CTL";   
      this.control_out_name=this.data_out_name+"/CTL";   


      let first=true;
      this.broker.listen(undefined,this.control_in_name, (data)=>{

        this.data_in_byte_count+=data[1][0].payload.length;
        if(first){
          //Check if we are a bridge and do auto forwarding
          let sender=data[0];
          let bridge=this.broker.bridges[sender];
          if(bridge){
            this.broker.listen(undefined, this.uuid, bridge, "begin");
          }
          on_connect && on_connect(this);
          first=false;
        }
        else {
          let p=fastpack.decode_meta_payload(data[1][0].payload);
          if(p.command == "back_pressure"){
            console.log("We have send this much ", this.data_out_byte_count);
            console.log("We have acked this much ", p.byte_count);
            console.log("backlog is", this.data_out_byte_count - p.byte_count);

            //Trigger high and low watermarks if needed
            this.data_out_byte_count -= p.byte_count;


            if(this.data_out_byte_count<this.low_watermark){
              this.on_low_watermark && this.on_low_watermark();
            }

            //this.on_control  && this.on_control(data[1][0].payload);
          }
          // Also pass the control message?
          this.on_control && this.on_control(p);


        }
      },
        "exact"
      );



      this.broker.listen(undefined,this.data_in_name, (data)=>{
        this.data_in_byte_count+=data[1][0].payload.length;
        this.on_data  && this.on_data(data[1][0].payload);
      },
        "exact");
    }
    // Setup back pressure
      let scope=this;
      this.byte_timer=setInterval(()=>{
        // If the channel is open we want to send a control message to the peer
        // with how many bytes habe been recieved ( and processed ?)
        let temp=scope.data_in_byte_count;
        scope.data_in_byte_count=0;     //Relative to last message
        if(temp){
          scope.send_control({command: "back_pressure", "byte_count": temp});
        }
      },100);


  }

  // Attempt to connect to an end point via the broker
  // IF the channel is to a remote host, all the topics begining with the
  // channels uuid need to be manually forwarded
  //
  connect(connection_endpoint, callback){

    this.uuid||uuid4();
    this.mode="slave";

    // Create the data we want to send
    let obj={
      uuid:                 this.uuid,
      rate_limit:           0,
      virtual_buffer_size:  16
    };

    let json=JSON.stringify(obj);
    let encoder=new TextEncoder();
    let encoded=encoder.encode(json);

    // Send an message to the end_point and hope that we get data...
    this._setup(undefined, callback);

    this.broker.broadcast(undefined, connection_endpoint, encoded);
  }

  close(){
    broker.ignore(undefined, this.data_in_name, undefined, "exact", "sub");
    broker.ignore(undefined, this.data_out_name, undefined, "exact", "sub");
    broker.ignore(undefined, this.control_in_name, undefined, "exact", "sub");
    broker.ignore(undefined, this.control_out_name, undefined, "exact", "sub");
    broker.ignore(undefined, this.uuid, undefined, "begin", "sub");
    
  }


  // Adds a 'listener' to establish a channel
  // This is a static/class method used on the 'master
  // NOTE: thei connection_endpoint also needs to be manually forward over bridges if desired
  // 
  static accept(connection_endpoint, broker, callback){

      broker.listen(undefined, connection_endpoint, (data)=>{

      let sender=data[0];
      let codec=new TextDecoder();
      let value= data[1][0].payload;
      let decoded=codec.decode(value);

      let object=JSON.parse(decoded);

      let channel=new uSACFastPackChannel(object.uuid, broker, "master");
      
      channel._setup(sender, callback);
    },
    "exact");
  }

  send_data(data, cb){
    // Check that we are no more than 
    this.data_out_byte_count+=data.length;
    this.broker.broadcast(undefined, this.data_out_name, data);
    if(this.data_out_byte_count>=this.high_watermark){
      setTimeout(()=>{this.on_high_watermark && this.on_high_watermark();
      },0);
    }
  }

  send_control(data){
    let p=fastpack.encode_meta_payload(data);
    this.data_out_byte_count+=p.length;
    this.broker.broadcast(undefined, this.control_out_name, p);
  }


}




  if (typeof module === "object" && module && typeof module.exports === "object") {
    // Node.js
    //module.exports = uSACFastPackBroker;
  }
  else {
    // Global object
    window.uSACFastPackBroker         = uSACFastPackBroker;
    window.uSACFastPackBrokerBridgeStream   = uSACFastPackBrokerBridgeStream;
    window.uSACFastPackBrokerBridgeFrame   = uSACFastPackBrokerBridgeFrame;
    window.uSACFastPackBrokerBridgeWS = uSACFastPackBrokerBridgeWS;
    window.uSACFastPackBrokerBridge   = uSACFastPackBrokerBridge;
    window.WebSocketPB= WebSocketBP;
    window.uSACFastPackChannel= uSACFastPackChannel;
    if(window.broker == undefined){
      window.broker=new uSACFastPackBroker();
    }
  }


})();

