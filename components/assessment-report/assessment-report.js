Component({
  properties:{view:{type:Object,value:null},busy:{type:Boolean,value:false}},
  methods:{
    deepen:function(){this.triggerEvent('deepen')},
    retry:function(){this.triggerEvent('retry')},
    exportReport:function(){this.triggerEvent('export')}
  }
})
