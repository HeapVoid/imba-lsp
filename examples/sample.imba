# Parser smoke sample

# class { db } from './db.imba'

tag app-root
	title = "Imba in Zed"

	css self
		d:flex
		g:12px
		.title
			c:blue6

	def save
		console.log("save")

	<self>
		<div.card @click=(do save!) [d:flex g:8px]>
			<span.title> title
				<span> 'Hello world'
