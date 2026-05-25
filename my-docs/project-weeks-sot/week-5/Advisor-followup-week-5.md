# Gauntlet Advisor Followup Week 5

## Transcript: Fleet Graph Assignment Introduction

Hey everybody, I realize I'm not gonna be available Monday morning, so I thought I would give you a video introduction to your assignment for this week.

So, this week is Fleet Graph, and what you're gonna do is now build an agent inside of ship. So now you are very aware of everything it has to offer, and also all of its flaws that hopefully you fixed a lot of in this last week. You're now gonna put an agent inside of it, but this agent's gonna be a little bit different. It's gonna be a proactive agent, one that will respond to the events within the application, and so you're gonna have to set it up so that it can respond and involve humans when it should, and not involve humans when it doesn't have to.

So I'll let you read through this background, but the main thing here is that it should be a proactive agent. So again, one that responds to the events within the app, and does work for the person.

Really quick, the four deadlines are your pretty typical standard ones:

* **Architecture defense** will be today, just four hours after you get this assignment. So, a chance to get together and collaborate, discuss your ideas, and critique each other's ideas of how you're gonna approach this.
* Then, of course, **MVP** is Tuesday.
* **Early submission** Thursday.
* **Final submission** Sunday at noon. Enjoy that time off, take a break, get some sleep, do whatever it is you need to do to recharge and be ready for the next week.

So, there are gonna be two modes of fleet graph. I want it to be the same graph, though, at the end of the day. You have the proactive agent, and then you have the on-demand one—the one where the user's typing and doing things. And I want you to try to do this with the same graph. I realize that it could be two separate graphs, but I want you to challenge yourselves to try to consolidate these so that you can route things the right way based on, you know, whatever it is you want to base it on. I'm not gonna give you any more guidance than that.

But, what is this agent responsible for? You must define this. You know the project, you know the app, so you go through and answer: How is it gonna be proactive? How is it going to fulfill the space that it's in? How it's going to help people using ship get their job done faster? How many steps can you eliminate from the human so the human only has to do what it needs to?

And one other point I'll make there: sometimes agents do so much for us—and I mean, we all feel this way sometimes—that we don't actually know what is going on, and we start to lose context. So I challenge you, as you go through this, to think about that experience, and see if you can create an agent that gives them that context, but they still feel like they know what's going on.

All right. If you have your trigger models, I think we talked about that. Observability is going to be really critical. In fact, we're going to want to see some traces as part of your submission, to know what—just to make sure that you have these two paths defined. I'm not looking for anything really specific here, just looking for two distinct paths from the proactive versus the user chat side. So there's a list of—shouldn't be too—nothing too hair-raising there, so I'm not going to go through them here.

There are some performance requirements. We don't want this to be slow, and so I just want you to be cognizant of that. And then of course, in test cases, you'll want to define those as well. Analysis is pretty standard stuff, I would say, up to this point.

So anyway, there is all of your deliverables that you'll need. Here's some constraints. There aren't super strong constraints, I'll admit. LangGraph is recommended, but you don't have to use LangGraph. LangSmith for tracing—I'm actually going to go ahead and probably nix this one. You can use whatever you want, as long as it gives us a link. I'll just put the constraints to: Observability required from day one with traces, I'll say. That might be redundant, but I'll just be extra clear there. Observability with trace required from day one. There we go.

The chat interface must be embedded in the context. What I mean by that is your chat interface should be on the page and should be aware of the page that it's on. That's what I mean by embedded in context. So if you're on a page of this particular project task, it should know about that.

---

## Key Takeaways & Summary

* **Core Objective:** Build a proactive agent inside the "ship" application that responds to app events, automates tasks to reduce human steps, and knows exactly when to involve (or not involve) a human.
* **Dual-Mode Graph Challenge:** The agent must support two modes—proactive (event-driven) and on-demand (user typing)—consolidated into a *single* graph that handles routing internally.
* **User Experience Challenge:** Balance automation with context. The agent should complete tasks without making the user feel out of the loop or confused about what just happened.
* **Deadlines:**
* **Architecture Defense:** Today (4 hours post-release)
* **MVP:** Tuesday
* **Early Submission:** Thursday
* **Final Submission:** Sunday at noon

* **Constraints & Requirements:**
* **Observability:** Required from day one. Submissions must include trace links showing two distinct execution paths (proactive vs. user chat). Any tracing tool is acceptable.
* **UI Integration:** The chat interface must be context-aware, meaning it directly knows about the specific page or project task the user is currently viewing.
* **Frameworks:** LangGraph is recommended but optional.
