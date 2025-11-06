// Simple drawing state manager: stores operations and supports global undo/redo
class DrawingState {
  constructor(){
    this.ops = []; // committed operations [{id, author, type, ...}]
    this.redoStack = [];
    this.nextId = 1;
  }

  addOp(op, author){
    const o = Object.assign({}, op);
    o.id = this.nextId++;
    o.author = author || null;
    this.ops.push(o);
    this.redoStack = [];
    return o;
  }

  getOps(){ return this.ops.slice(); }

  undo(){
    if(this.ops.length===0) return null;
    const op = this.ops.pop();
    this.redoStack.push(op);
    return op;
  }

  undoBy(author){
    for(let i=this.ops.length-1;i>=0;i--){
      if(this.ops[i].author === author){
        const [op] = this.ops.splice(i,1);
        this.redoStack.push(op);
        return op;
      }
    }
    return null;
  }

  redo(){
    if(this.redoStack.length===0) return null;
    const op = this.redoStack.pop();
    this.ops.push(op);
    return op;
  }

  redoBy(author){
    for(let i=this.redoStack.length-1;i>=0;i--){
      if(this.redoStack[i].author === author){
        const [op] = this.redoStack.splice(i,1);
        this.ops.push(op);
        return op;
      }
    }
    return null;
  }

  clear(){ this.ops = []; this.redoStack = []; }
}

function createState(){ return new DrawingState(); }

module.exports = { createState };
