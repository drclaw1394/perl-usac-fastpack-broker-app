(function(){


  /**********************************************************************************************/
  /* function bridge_to_parent(){                                                               */
  /*                                                                                            */
  /*   // Attempt to link to parent window or if top level window, attempt to                   */
  /*   // connect back to the host we loaded from                                               */
  /*   //                                                                                       */
  /*   let forward=[".*"];                                                                      */
  /*   try {                                                                                    */
  /*     if(window.self !== window.top){                                                        */
  /*       //Inside an iframe;                                                                  */
  /*       window.parent_bridge=new uSACFastPackBrokerBridgeFrame(broker, forward, window.top); */
  /*     }                                                                                      */
  /*     else {                                                                                 */
  /*       // We are the top level                                                              */
  /*       let ws=new WebSocket("/ws");                                                         */
  /*       window.parent_bridge=new uSACFastPackBrokerBridgeWS(broker, forward, ws);            */
  /*     }                                                                                      */
  /*                                                                                            */
  /*   }                                                                                        */
  /*   catch(e){                                                                                */
  /*     // Cross origin restrictions, we are likely a iframe                                   */
  /*     //window.parent_bridge=new uSACFastPackBrokerBridgeFrame(broker, forward, window.top); */
  /*   }                                                                                        */
  /* }                                                                                          */
  /**********************************************************************************************/


  function run(){
    //Create a new broker if needed
    window.broker||=new uSACFastPackBroker();

    /***************************************************************/
    /* console.log("-=-==-=- FIRST LISTEN");                       */
    /* broker.listen(undefined, "test", (msg)=>{                   */
    /*   console.log("--GOT Message TEST, with value", msg);       */
    /* });                                                         */
    /*                                                             */
    /* let cbb=(msg)=>{                                            */
    /*   console.log("--GOT Message TEST AGAIN, with value", msg); */
    /* };                                                          */
    /*                                                             */
    /* console.log("-=-==-=- SECOND LISTEN");                      */
    /* broker.listen(undefined, "test", cbb);                      */
    /*                                                             */
    /* broker.broadcast(undefined, "test", "data goes here");      */
    /*                                                             */
    /* console.log("Doing broadcast");                             */
    /* broker.broadcast(undefined, "test", "data goes here");      */
    /*                                                             */
    /* console.log("Doing IGNORE");                                */
    /* broker.ignore(undefined, "test", cbb);                      */
    /*                                                             */
    /* console.log("Doing broadcast after ignore");                */
    /* broker.broadcast(undefined, "test", "data goes here");      */
    /*                                                             */
    /***************************************************************/

    //bridge_to_parent();

    // Create a bridge to the upstream broker.
    //
    // Accepts a pairwsie list of matcher and type to automaticall forward
    uSACFastPackBroker.bridge_to_parent(["remote_end_point"]);
    

    //return;
    setTimeout(()=>{

    let encoder=new TextEncoder();
    /***********************************************************/
    /*                                                         */
    /* broker.listen(undefined, "test", window.parent_bridge); */
    /*                                                         */
    /* let t=setInterval(()=>{                                 */
    /*   let data= encoder.encode("test data");                */
    /*   console.log("Sending data ", data);                   */
    /*   broker.broadcast(undefined, "test", data);            */
    /* }, 1000);                                               */
    /*                                                         */
    /* broker.listen(undefined, "return", (data)=>{            */
    /*   console.log("RETURN", data);                          */
    /* });                                                     */
    /*                                                         */
    /* broker.listen(undefined, '.*', (data)=>{                */
    /*   console.log("CATCH ALL", data);                       */
    /* });                                                     */
    /***********************************************************/

    //Test channels
    window.slave=new uSACFastPackChannel(undefined, window.broker);
    console.log("--Slave channel ok?", slave!==undefined);

    /*********************************************************************/
    /* let master;                                                       */
    /* uSACFastPackChannel.accept("end_point", window.broker, (ch)=>{    */
    /*   master=ch;                                                      */
    /*   console.log("--Master channel accept ok?", master!==undefined); */
    /*   master.on_data=(data)=>{                                        */
    /*     console.log("MASTER GOT DATA", data);                         */
    /*   };                                                              */
    /*   master.on_control=(data)=>{                                     */
    /*     console.log("MASTER GOT CONTROL", data);                      */
    /*   };                                                              */
    /*                                                                   */
    /*   master.send_control("MOSI");                                    */
    /*   master.send_data("MOSI");                                       */
    /*                                                                   */
    /* });                                                               */

    slave.on_data=(data)=>{
      console.log("SLAVE GOT DATA", data);
    };

    slave.on_control=(data)=>{
      console.log("SLAVE GOT CONTROL", data);
    };

    slave.connect("remote_end_point", (ch)=>{
      console.log("ON connect slave");
      setInterval(()=>{
        console.log("SENDING TO REMOTE");
        slave.send_data(encoder.encode("MISO"));
      }, 1000);
      //slave.send_control("MISO");
    });

    }, 2000);
  }







  
  if (typeof module === "object" && module && typeof module.exports === "object") {
    // Node.js
    module.exports =run;
  }
  else {
    // Global object
    window.uSACFastPackBrokerTest=run;
  }
}
)();



