/** Insert canonical amendments before the next numbered chapter, outside fenced code. */
export function composeSpec(source, additions){
  const pending=new Map(additions),output=[];let fence=null;
  for(const line of source.split('\n')){
    const mark=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){
      if(mark&&mark[1][0]===fence.char&&mark[1].length>=fence.length&&!mark[2].trim())fence=null;
      output.push(line);continue;
    }
    if(mark){fence={char:mark[1][0],length:mark[1].length};output.push(line);continue;}
    const chapter=/^##\s+(\d+)\.?\s/.exec(line);
    if(chapter&&pending.has(Number(chapter[1]))){output.push(pending.get(Number(chapter[1])),'');pending.delete(Number(chapter[1]));}
    output.push(line);
  }
  if(pending.size)throw new Error('Master-spec chapter structure changed; review extension placement');
  return output.join('\n');
}
