import React from 'react';
import io from 'socket.io-client';
import webrtc from 'webrtc-adapter';

const server = location.origin;
const socket = io(server);

let localStream;
let remoteStream;
let turnReady;
let pc;

const configuration = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

let sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

class Video extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      constraints: {
        video: true,
        audio: true
      },
      video: 'Video Off',
      mute: 'Mute',
      videoScreen: true,
      startButton: false,
      isChannelReady: false,
      isInitiator: false,
      isStarted: false
    };
    this.createRoom = this.createRoom.bind(this);
    this.connectSockets = this.connectSockets.bind(this);
    this.gotStream = this.gotStream.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.maybeStart = this.maybeStart.bind(this);
    this.start = this.start.bind(this);
    this.doCall = this.doCall.bind(this);
    this.doAnswer = this.doAnswer.bind(this);
    this.handleCreateOfferError = this.handleCreateOfferError.bind(this);
    this.setLocalAndSendMessage = this.setLocalAndSendMessage.bind(this);
    this.createPeerConnection = this.createPeerConnection.bind(this);
    this.handleIceCandidate = this.handleIceCandidate.bind(this);
    this.onSetSessionDescriptionError = this.onSetSessionDescriptionError.bind(this);
    // this.requestTurn = this.requestTurn.bind(this);
    this.handleRemoteStreamAdded = this.handleRemoteStreamAdded.bind(this);
    this.handleRemoteStreamRemoved = this.handleRemoteStreamRemoved.bind(this);
    this.hangup = this.hangup.bind(this);
    this.handleRemoteHangup = this.handleRemoteHangup.bind(this);
    this.stop = this.stop.bind(this);
    // this.handleVideoScreen = this.handleVideoScreen.bind(this);
    // this.handleAudio = this.handleAudio.bind(this);
  }

  componentDidMount() {
    let localVideo = document.getElementById('localVideo');
    let remoteVideo = document.getElementById('remoteVideo');
    this.start();
    this.createRoom();
    this.connectSockets();
  }


  // CreateRoom method if required later
  createRoom() {
    let room = 'foo';
    // window.room = prompt('Enter room name:');

    let socket = io.connect();

    if (room !== '') {
      socket.emit('create or join', room);
      console.log(`Creating or joining room ${room}`);
    }

    socket.on('Created', (room) => {
      console.log(`Created room ${room}`);
      this.setState({
        isInitiator: true
      });
    });

    socket.on('Full', (room) => {
      console.log(`Room ${room} is full :^(')`);
    });

    socket.on('ipaddr', (ipaddr) => {
      console.log(`Server IP address is ${ipaddr}`);
    });

    socket.on('Join', (room) => {
      console.log(`Another peer made a request to join room ${room}`);
      this.setState({
        isChannelReady: true
      });
    });

    socket.on('Joined', (room) => {
      console.log(`You just joined: ${room}`);
      this.setState({
        isChannelReady: true
      });
    });

    socket.on('Log', (array) => {
      console.log.apply(console, array);
    });
  }

  sendMessage(message) {
    console.log(`Client sending message: ${message}`);
    socket.emit('video message', message);
  }

  start() {
    navigator.mediaDevices.getUserMedia(this.state.constraints)
      .then(this.gotStream)
      // .then(this.createPeerConnection)
      .catch((error) => {
        alert(`getUserMedia() error: ${error.name}`);
      });
  }

  connectSockets() {
    socket.on('video message', (message) => {
      console.log(`Client received message: ${message}`);
      if (message === 'got user media') {
        this.maybeStart();
      } else if (message.type === 'offer') {
        if (!this.state.isInitiator && !this.state.isStarted) {
          this.maybeStart();
        }
        pc.setRemoteDescription(new RTCSessionDescription(message));
        this.doAnswer();
      } else if (message.type === 'answer' && this.state.isStarted) {
        pc.setRemoteDescription(new RTCSessionDescription(message));
      } else if (message.type === 'candidate' && this.state.isStarted) {
        const candidate = new RTCIceCandidate({
          sdpMLineIndex: message.label,
          candidate: message.candidate
        });
        pc.addIceCandidate(candidate);
      } else if (message === 'bye' && this.state.isStarted) {
        this.handleRemoteHangup();
      }
    });
  }

  // Initiates video from the local camera by creating an object blob URL (https://www.html5rocks.com/en/tutorials/workers/basics/#toc-inlineworkers-bloburis) from camera data stream and setting that URL as the source for the element
  gotStream(stream) {
    console.log('This adds a local stream');
    localVideo.srcObject = stream;
    localStream = stream; 
    console.log('This is the local stream', localStream);
    this.sendMessage('got user media');
    console.log('We want this to be true for peer', this.state.isInitiator);
    // This should be set to true until the caller session is terminated
    if (this.state.isInitiator) {
      this.maybeStart();
    }
  }

  // This is invoked in multiple places but only runs based on a detailed set of conditionals
  // If no connection, local stream is available, and channel is ready for signaling
  // A connection is created and passed the local video stream.
  // Started state is set to true to avoid a connection starting multiple times
  maybeStart() {
    console.log('>>>>>>> maybeStart() ', this.state.isStarted, localStream, this.state.isChannelReady);
    if (!this.state.isStarted && typeof localStream !== 'undefined' && this.state.isChannelReady) {
      console.log('>>>>>> creating peer connection');
      this.createPeerConnection();
      pc.addStream(localStream);
      this.setState({
        isStarted: true
      });
      console.log('This is the second time so isInitiator should still be true', this.state.isInitiator);
      if (this.state.isInitiator) {
        this.doCall();
      }
    }
  }

  // Create a connection using a STUN server
  // Set log handlers for peer connection events
  // Except remote stream handler which sets the source for the remoteVideo element
  createPeerConnection() {
    try {
      pc = new RTCPeerConnection(null);
      console.log('WHAT IS THIS PC', pc);
      pc.onicecandidate = this.handleIceCandidate;
      console.log('This is pconice', pc.onicecandidate);
      pc.onaddstream = this.handleRemoteStreamAdded;
      pc.onremovestream = this.handleRemoteStreamRemoved;
      console.log('Created RTCPeerConnnection');
    } catch (event) {
      console.log(`Failed to create PeerConnection, exception: ${event.message}`);
      alert('Cannot create RTCPeerConnection object.');
      return;
    }
  }

  // Once connection is created, since the initiator state should still be true, a call we begin
  // An offer is sent from the local stream to the callee
  doCall() {
    console.log('Sending offer to peer');
    pc.createOffer(this.setLocalAndSendMessage, this.handleCreateOfferError);
  }

  doAnswer() {
    console.log('Sending answer to peer.');
    pc.createAnswer().then(
      this.setLocalAndSendMessage,
      this.onSetSessionDescriptionError
    );
  }

  // Message sent to remote peer giving a serialised Session Description for the offer
  setLocalAndSendMessage(sessionDescription) {
    console.log('This is the session description', sessionDescription);
    pc.setLocalDescription(sessionDescription);
    console.log(`setLocalAndSendMessage sending message ${sessionDescription}`);
    this.sendMessage(sessionDescription);
  }

  handleCreateOfferError(event) {
    console.log(`createOffer() error: ${event}`);
  }

  onSetSessionDescriptionError(error) {
   console.log(`Failed to set session description: ${error.toString()}`);
  }


  /////////////////////////////
  // Request handlers for RTCPeerConnection events
  handleIceCandidate(event) {
    console.log(`ICEcandidate event: ${event}`);
    if (event.candidate) {
      this.sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      });
    } else {
      console.log('End of candidates.');
    }
  }

  handleRemoteStreamAdded(event) {
    window.remoteStream = remoteVideo.srcObject;
    remoteVideo.srcObject = event.stream;
    console.log('Remote stream added');
  }

  handleRemoteStreamRemoved(event) {
    console.log(`Remote stream removed. Event: ${event}`);
  }

  /////////////////////////////////

  hangup() {
    console.log('Hanging up.');
    this.stop();
    sendMessage('bye');
  }

  handleRemoteHangup() {
    console.log('Session terminated.');
    this.stop();
    this.setState({
      isInitiator: false
    });
  }

  stop() {
    this.setState({
      isStarted: false
    });
    pc.close();
    pc = null;
  }

  // handleVideoScreen() {
  //   this.setState({
  //     constraints: {
  //       video: !this.state.constraints.video,
  //       audio: this.state.constraints.audio
  //     },
  //     video: !this.state.constraints.video ? 'Video Off' : 'Video On'
  //   }, () => (this.start()));
  // }

  // handleAudio() {
  //   this.setState({
  //     constraints: {
  //       video: this.state.constraints.video,
  //       audio: !this.state.constraints.audio
  //     },
  //     mute: !this.state.constraints.audio ? 'Mute' : 'Unmute'
  //   }, () => (this.start()));
  //   navigator.mediaDevices.getUserMedia(this.state.constraints)
  //     .then(this.successCallback)
  //     .catch(this.errorCallback);
  // }

  render() {
    return (
      <div className="row border right-side">
        <video id="localVideo" autoPlay />
        <video id="remoteVideo" autoPlay />
        <div>
          <button className="videoOff" onClick={this.handleVideoScreen}>{this.state.video}</button>
          <button className="mute" onClick={this.handleAudio}>{this.state.mute}</button>
        </div>
      </div>
    );
  }
}

export default Video;
